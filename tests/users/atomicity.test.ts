import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { verifyCredentials } from "@/server/auth/credentials";
import { hashPassword } from "@/server/auth/password";
import { createRole, deleteRole, updateRoleInfo, updateRolePermissions } from "@/server/roles/service";
import {
  changeOwnPassword, createUser, createUserIdempotent, resetPassword, setLocked, setUserRoles, updateProfile,
} from "@/server/users/service";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

// Ghi = 1 transaction + writeAudit cùng transaction: audit hỏng ⇒ MỌI thay đổi nghiệp vụ phải rollback.
vi.mock("@/server/audit/write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/audit/write")>();
  return { ...actual, writeAudit: vi.fn(actual.writeAudit) };
});

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
const failAudit = () => vi.mocked(writeAudit).mockRejectedValueOnce(new Error("audit down"));

let actor: Actor;
let roleId: Record<string, number>;

beforeEach(async () => {
  vi.mocked(writeAudit).mockClear();
  await resetDb();
  await seed(prisma);
  roleId = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  const u = await prisma.user.create({
    data: { username: "admin", fullName: "Admin", passwordHash: await hashPassword("Admin12345"), roles: { create: { roleId: roleId["Giám đốc"]! } } },
  });
  actor = { userId: u.id, perms: new Set(ALL_PERMISSION_CODES) };
});

async function seedUser(username = "nam", roles = ["Bán hàng"]) {
  return prisma.user.create({
    data: { username, fullName: "Nam", passwordHash: await hashPassword("Cu12345678"), roles: { create: roles.map((r) => ({ roleId: roleId[r]! })) } },
  });
}

describe("audit hỏng ⇒ rollback toàn bộ", () => {
  it("createUser: không tạo user", async () => {
    failAudit();
    await expect(tx((db) => createUser(db, actor, { username: "moi", fullName: "Mới", roleIds: [roleId["Bán hàng"]!] }))).rejects.toThrow("audit down");
    expect(await prisma.user.count({ where: { username: "moi" } })).toBe(0);
  });

  it("createUserIdempotent: không tạo user, KHÔNG để lại khoá idempotency; gửi lại cùng khoá thì tạo được", async () => {
    failAudit();
    await expect(createUserIdempotent(prisma, actor, "k", { username: "moi", fullName: "Mới", roleIds: [roleId["Bán hàng"]!] })).rejects.toThrow("audit down");
    expect(await prisma.user.count({ where: { username: "moi" } })).toBe(0);
    expect(await prisma.idempotencyKey.count()).toBe(0);
    const ok = await createUserIdempotent(prisma, actor, "k", { username: "moi", fullName: "Mới", roleIds: [roleId["Bán hàng"]!] });
    expect(ok.tempPassword).toEqual(expect.any(String));
  });

  it("updateProfile: họ tên giữ nguyên", async () => {
    const u = await seedUser();
    failAudit();
    await expect(tx((db) => updateProfile(db, actor, u.id, { fullName: "Tên khác" }))).rejects.toThrow("audit down");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).fullName).toBe("Nam");
  });

  it("setUserRoles: vai trò giữ nguyên", async () => {
    const u = await seedUser();
    failAudit();
    await expect(tx((db) => setUserRoles(db, actor, u.id, [roleId["Kế toán"]!]))).rejects.toThrow("audit down");
    expect((await prisma.userRole.findMany({ where: { userId: u.id } })).map((r) => r.roleId)).toEqual([roleId["Bán hàng"]]);
  });

  it("setLocked: không khoá", async () => {
    const u = await seedUser();
    failAudit();
    await expect(tx((db) => setLocked(db, actor, u.id, true))).rejects.toThrow("audit down");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).isLocked).toBe(false);
  });

  it("resetPassword: mật khẩu cũ vẫn dùng được, không bắt đổi mật khẩu", async () => {
    const u = await seedUser();
    failAudit();
    await expect(tx((db) => resetPassword(db, actor, u.id))).rejects.toThrow("audit down");
    expect((await verifyCredentials(prisma, "nam", "Cu12345678")).ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).mustChangePassword).toBe(false);
  });

  it("changeOwnPassword: mật khẩu cũ vẫn dùng được", async () => {
    const u = await seedUser();
    failAudit();
    await expect(tx((db) => changeOwnPassword(db, { userId: u.id, perms: new Set() }, { current: "Cu12345678", next: "Moi12345678" }))).rejects.toThrow("audit down");
    expect((await verifyCredentials(prisma, "nam", "Cu12345678")).ok).toBe(true);
    expect((await verifyCredentials(prisma, "nam", "Moi12345678")).ok).toBe(false);
  });

  it("createRole / updateRoleInfo / updateRolePermissions / deleteRole: không đổi gì", async () => {
    failAudit();
    await expect(tx((db) => createRole(db, actor, { name: "Nhóm mới" }))).rejects.toThrow("audit down");
    expect(await prisma.role.count({ where: { name: "Nhóm mới" } })).toBe(0);

    const r = await prisma.role.create({ data: { name: "Trợ lý", description: "cũ" } });
    failAudit();
    await expect(tx((db) => updateRoleInfo(db, actor, r.id, { name: "Đổi tên", description: "mới" }))).rejects.toThrow("audit down");
    expect(await prisma.role.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ name: "Trợ lý", description: "cũ" });

    failAudit();
    await expect(tx((db) => updateRolePermissions(db, actor, r.id, ["order.view"]))).rejects.toThrow("audit down");
    expect(await prisma.rolePermission.count({ where: { roleId: r.id } })).toBe(0);

    failAudit();
    await expect(tx((db) => deleteRole(db, actor, r.id))).rejects.toThrow("audit down");
    expect(await prisma.role.count({ where: { id: r.id } })).toBe(1);
  });
});
