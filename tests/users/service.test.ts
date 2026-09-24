import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { verifyCredentials } from "@/server/auth/credentials";
import { hashPassword } from "@/server/auth/password";
import { DomainError } from "@/server/http/errors";
import {
  changeOwnPassword, createUser, resetPassword, setLocked, setUserRoles, updateProfile,
} from "@/server/users/service";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);

let admin: { id: number; actor: Actor };
let roleId: Record<string, number>;

async function makeAdmin() {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } });
  const u = await prisma.user.create({
    data: { username: "admin", fullName: "Admin", passwordHash: await hashPassword("Admin12345"), roles: { create: { roleId: role.id } } },
  });
  const perms = new Set((await prisma.rolePermission.findMany({ where: { roleId: role.id }, include: { permission: true } })).map((r) => r.permission.code));
  return { id: u.id, actor: { userId: u.id, perms } as Actor };
}

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  roleId = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  admin = await makeAdmin();
});

const input = (over = {}) => ({ username: "Nam", fullName: "Nguyễn Nam", roleIds: [roleId["Bán hàng"]!], ...over });

describe("createUser", () => {
  it("tạo user: username chữ thường, mật khẩu tạm dùng được, bắt đổi mật khẩu, gán vai trò", async () => {
    const r = await tx((db) => createUser(db, admin.actor, input()));
    expect(r.username).toBe("nam");
    const u = await prisma.user.findUniqueOrThrow({ where: { id: r.id }, include: { roles: true } });
    expect(u.mustChangePassword).toBe(true);
    expect(u.roles.map((x) => x.roleId)).toEqual([roleId["Bán hàng"]]);
    expect(await bcrypt.compare(r.tempPassword, u.passwordHash)).toBe(true);
    expect((await verifyCredentials(prisma, "NAM", r.tempPassword)).ok).toBe(true);
  });

  it("ghi audit user.create — KHÔNG chứa mật khẩu tạm hay hash", async () => {
    const r = await tx((db) => createUser(db, admin.actor, input()));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.create" } });
    const text = JSON.stringify(log);
    expect(text).not.toContain(r.tempPassword);
    expect(text).not.toMatch(/\$2[aby]\$/); // hash bcrypt
    expect(text).not.toContain("passwordHash");
    expect(log.afterJson).toMatchObject({ username: "nam", fullName: "Nguyễn Nam", roles: ["Bán hàng"] });
    expect(log.userId).toBe(admin.id);
  });

  it("trùng tên đăng nhập (không phân biệt hoa thường) → lỗi tiếng Việt", async () => {
    await tx((db) => createUser(db, admin.actor, input()));
    await expect(tx((db) => createUser(db, admin.actor, input({ username: "NAM" })))).rejects.toThrow("Tên đăng nhập đã tồn tại.");
  });

  it("thiếu quyền user.manage → ForbiddenError, không ghi gì", async () => {
    const weak: Actor = { userId: admin.id, perms: new Set(["user.view"]) };
    await expect(tx((db) => createUser(db, weak, input()))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.user.count()).toBe(1);
  });

  it("vai trò không tồn tại → lỗi", async () => {
    await expect(tx((db) => createUser(db, admin.actor, input({ roleIds: [99999] })))).rejects.toBeInstanceOf(DomainError);
  });
});

describe("khoá / mở khoá (mã 4)", () => {
  it("khoá → không đăng nhập được (LOCKED); mở khoá → đăng nhập lại được; có audit", async () => {
    const r = await tx((db) => createUser(db, admin.actor, input()));
    await tx((db) => setLocked(db, admin.actor, r.id, true));
    expect(await verifyCredentials(prisma, "nam", r.tempPassword)).toEqual({ ok: false, reason: "LOCKED" });
    await tx((db) => setLocked(db, admin.actor, r.id, false));
    expect((await verifyCredentials(prisma, "nam", r.tempPassword)).ok).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: { in: ["user.lock", "user.unlock"] } } })).toBe(2);
  });

  it("không tự khoá chính mình", async () => {
    await expect(tx((db) => setLocked(db, admin.actor, admin.id, true))).rejects.toThrow("Bạn không thể tự khóa tài khoản của mình.");
  });

  it("khoá quản trị viên CUỐI CÙNG bị chặn và ROLLBACK", async () => {
    const other = await tx((db) => createUser(db, admin.actor, input({ username: "ketoan", roleIds: [roleId["Kế toán"]!] })));
    const actorB: Actor = { userId: other.id, perms: new Set(["user.manage"]) }; // người thực hiện khác, không phải admin
    await expect(tx((db) => setLocked(db, actorB, admin.id, true))).rejects.toThrow(/ít nhất một tài khoản/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).isLocked).toBe(false); // đã rollback
  });

  it("khoá khi còn quản trị viên khác → được", async () => {
    const second = await tx((db) => createUser(db, admin.actor, input({ username: "admin2", roleIds: [roleId["Giám đốc"]!] })));
    await tx((db) => setLocked(db, admin.actor, second.id, true));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: second.id } })).isLocked).toBe(true);
  });
});

describe("vai trò & hồ sơ", () => {
  it("đổi vai trò: ghi audit số cũ/số mới", async () => {
    const r = await tx((db) => createUser(db, admin.actor, input()));
    await tx((db) => setUserRoles(db, admin.actor, r.id, [roleId["Thủ kho"]!, roleId["Thủ quỹ"]!]));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.set_roles" } });
    expect(log.beforeJson).toEqual({ roles: ["Bán hàng"] });
    expect((log.afterJson as { roles: string[] }).roles.sort()).toEqual(["Thủ kho", "Thủ quỹ"]);
  });

  it("gỡ vai trò quản trị của người quản trị CUỐI CÙNG bị chặn", async () => {
    await expect(tx((db) => setUserRoles(db, admin.actor, admin.id, [roleId["Bán hàng"]!]))).rejects.toThrow(/ít nhất một tài khoản/);
    const roles = await prisma.userRole.findMany({ where: { userId: admin.id } });
    expect(roles.map((x) => x.roleId)).toEqual([roleId["Giám đốc"]]);
  });

  it("phải chọn ít nhất 1 vai trò", async () => {
    const r = await tx((db) => createUser(db, admin.actor, input()));
    await expect(tx((db) => setUserRoles(db, admin.actor, r.id, []))).rejects.toThrow(/ít nhất 1 nhóm quyền/);
  });

  it("sửa họ tên: audit trước/sau", async () => {
    const r = await tx((db) => createUser(db, admin.actor, input()));
    await tx((db) => updateProfile(db, admin.actor, r.id, { fullName: "Nam Nguyễn" }));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.update_profile" } });
    expect(log.beforeJson).toEqual({ fullName: "Nguyễn Nam" });
    expect(log.afterJson).toEqual({ fullName: "Nam Nguyễn" });
  });
});

describe("cấp lại / đổi mật khẩu (mã 1)", () => {
  it("cấp lại: mật khẩu cũ hết tác dụng, mật khẩu mới dùng được, bắt đổi lại; audit không chứa mật khẩu", async () => {
    const created = await tx((db) => createUser(db, admin.actor, input()));
    await prisma.user.update({ where: { id: created.id }, data: { mustChangePassword: false } });
    const r = await tx((db) => resetPassword(db, admin.actor, created.id));
    expect((await verifyCredentials(prisma, "nam", created.tempPassword)).ok).toBe(false);
    expect((await verifyCredentials(prisma, "nam", r.tempPassword)).ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).mustChangePassword).toBe(true);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.reset_password" } });
    expect(JSON.stringify(log)).not.toContain(r.tempPassword);
  });

  it("tự đổi mật khẩu: sai mật khẩu hiện tại → lỗi; mật khẩu yếu → lỗi; đúng → mustChange=false", async () => {
    const created = await tx((db) => createUser(db, admin.actor, input()));
    const self: Actor = { userId: created.id, perms: new Set() };
    await expect(tx((db) => changeOwnPassword(db, self, { current: "sai", next: "Xuong2026" }))).rejects.toThrow("Mật khẩu hiện tại không đúng.");
    await expect(tx((db) => changeOwnPassword(db, self, { current: created.tempPassword, next: "abc" }))).rejects.toThrow("Mật khẩu tối thiểu 8 ký tự.");
    await expect(tx((db) => changeOwnPassword(db, self, { current: created.tempPassword, next: created.tempPassword }))).rejects.toThrow(/khác mật khẩu hiện tại/);
    await tx((db) => changeOwnPassword(db, self, { current: created.tempPassword, next: "Xuong2026" }));
    const u = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(u.mustChangePassword).toBe(false);
    expect((await verifyCredentials(prisma, "nam", "Xuong2026")).ok).toBe(true);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.change_password" } });
    expect(JSON.stringify(log)).not.toContain("Xuong2026");
  });
});
