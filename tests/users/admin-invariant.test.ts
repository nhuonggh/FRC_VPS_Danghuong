import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";
import { hashPassword } from "@/server/auth/password";
import { updateRolePermissions } from "@/server/roles/service";
import { setLocked, setUserRoles } from "@/server/users/service";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

/**
 * Bất biến "luôn còn ≥ 1 tài khoản ĐANG HOẠT ĐỘNG có user.manage" (quyền = HỢP mọi vai trò).
 * Mỗi test chặn phải khẳng định: DB không đổi VÀ không có dòng audit nào được ghi.
 */
const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
const asActor = (userId: number): Actor => ({ userId, perms: new Set(ALL_PERMISSION_CODES) });

let roleId: Record<string, number>;

async function makeUser(username: string, roles: string[], isLocked = false) {
  return prisma.user.create({
    data: {
      username, fullName: username, isLocked, passwordHash: await hashPassword("Admin12345"),
      roles: { create: roles.map((r) => ({ roleId: roleId[r]! })) },
    },
  });
}
const auditCount = () => prisma.auditLog.count();
const roleIdsOf = async (userId: number) => (await prisma.userRole.findMany({ where: { userId } })).map((r) => r.roleId).sort();
const codesOf = async (rid: number) =>
  (await prisma.rolePermission.findMany({ where: { roleId: rid }, include: { permission: true } })).map((r) => r.permission.code);

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  roleId = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
});

describe("khoá tài khoản", () => {
  it("một mình là quản trị viên → tự khoá bị chặn (không ghi gì)", async () => {
    const a = await makeUser("admin", ["Giám đốc"]);
    const before = await auditCount();
    await expect(tx((db) => setLocked(db, asActor(a.id), a.id, true))).rejects.toThrow("Bạn không thể tự khóa tài khoản của mình.");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).isLocked).toBe(false);
    expect(await auditCount()).toBe(before);
  });

  it("hai quản trị viên: khoá một người được; rồi khoá người còn lại bị chặn, DB + audit nguyên vẹn", async () => {
    const a = await makeUser("admin1", ["Giám đốc"]);
    const b = await makeUser("admin2", ["Giám đốc"]);
    await tx((db) => setLocked(db, asActor(a.id), b.id, true));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.id } })).isLocked).toBe(true);
    const before = await auditCount();
    // actor là admin2 (đã bị khoá nhưng còn cầm perms cũ) cố khoá admin1 → hệ thống sẽ hết quản trị viên
    await expect(tx((db) => setLocked(db, asActor(b.id), a.id, true))).rejects.toThrow(/ít nhất một tài khoản/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).isLocked).toBe(false);
    expect(await auditCount()).toBe(before);
  });

  it("quản trị viên đã bị khoá KHÔNG được tính là còn quản trị viên", async () => {
    const a = await makeUser("admin1", ["Giám đốc"]);
    await makeUser("admin2", ["Giám đốc"], true); // đã khoá
    const helper = await makeUser("ketoan", ["Kế toán"]);
    await expect(tx((db) => setLocked(db, asActor(helper.id), a.id, true))).rejects.toThrow(/ít nhất một tài khoản/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).isLocked).toBe(false);
  });

  it("mở khoá luôn được phép (không làm giảm số quản trị viên)", async () => {
    const a = await makeUser("admin1", ["Giám đốc"]);
    const b = await makeUser("admin2", ["Giám đốc"], true);
    await tx((db) => setLocked(db, asActor(a.id), b.id, false));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.id } })).isLocked).toBe(false);
  });

  it("đồng thời: hai quản trị viên khoá lẫn nhau → đúng MỘT lệnh thành công, luôn còn 1 quản trị viên hoạt động", async () => {
    const a = await makeUser("admin1", ["Giám đốc"]);
    const b = await makeUser("admin2", ["Giám đốc"]);
    for (let i = 0; i < 6; i++) {
      await prisma.user.updateMany({ data: { isLocked: false } });
      const rs = await Promise.allSettled([
        tx((db) => setLocked(db, asActor(a.id), b.id, true)),
        tx((db) => setLocked(db, asActor(b.id), a.id, true)),
      ]);
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.user.count({ where: { isLocked: false } })).toBe(1);
    }
  });
});

describe("đổi vai trò của người dùng", () => {
  it("gỡ vai trò quản trị của quản trị viên cuối cùng bị chặn (không ghi gì)", async () => {
    const a = await makeUser("admin", ["Giám đốc"]);
    const before = await auditCount();
    await expect(tx((db) => setUserRoles(db, asActor(a.id), a.id, [roleId["Bán hàng"]!]))).rejects.toThrow(/ít nhất một tài khoản/);
    expect(await roleIdsOf(a.id)).toEqual([roleId["Giám đốc"]]);
    expect(await auditCount()).toBe(before);
  });

  it("quyền là HỢP các vai trò: quản trị viên thứ hai giữ user.manage qua vai trò phụ → gỡ Giám đốc của người kia được", async () => {
    const a = await makeUser("admin", ["Giám đốc"]);
    const custom = await prisma.role.create({ data: { name: "Quản lý tài khoản" } });
    const um = await prisma.permission.findUniqueOrThrow({ where: { code: "user.manage" } });
    await prisma.rolePermission.create({ data: { roleId: custom.id, permissionId: um.id } });
    const y = await prisma.user.create({
      data: {
        username: "y", fullName: "Y", passwordHash: "x",
        roles: { create: [{ roleId: roleId["Kế toán"]! }, { roleId: custom.id }] }, // Kế toán KHÔNG có user.manage, vai trò phụ có
      },
    });
    await tx((db) => setUserRoles(db, asActor(y.id), a.id, [roleId["Bán hàng"]!]));
    expect(await roleIdsOf(a.id)).toEqual([roleId["Bán hàng"]]);
    // giờ y là người cuối cùng: gỡ vai trò phụ của y bị chặn
    await expect(tx((db) => setUserRoles(db, asActor(y.id), y.id, [roleId["Kế toán"]!]))).rejects.toThrow(/ít nhất một tài khoản/);
    expect(await roleIdsOf(y.id)).toEqual([roleId["Kế toán"]!, custom.id].sort());
  });

  it("thêm vai trò quản trị cho người khác rồi mới gỡ của mình → được", async () => {
    const a = await makeUser("admin", ["Giám đốc"]);
    const b = await makeUser("nam", ["Bán hàng"]);
    await tx((db) => setUserRoles(db, asActor(a.id), b.id, [roleId["Giám đốc"]!]));
    await tx((db) => setUserRoles(db, asActor(a.id), a.id, [roleId["Bán hàng"]!]));
    expect(await roleIdsOf(a.id)).toEqual([roleId["Bán hàng"]]);
  });
});

describe("đổi quyền của nhóm", () => {
  const withoutManage = () => ALL_PERMISSION_CODES.filter((c) => c !== "user.manage");

  it("gỡ user.manage khỏi nhóm của quản trị viên cuối cùng bị chặn, quyền và audit nguyên vẹn", async () => {
    const a = await makeUser("admin", ["Giám đốc"]);
    const before = await auditCount();
    await expect(tx((db) => updateRolePermissions(db, asActor(a.id), roleId["Giám đốc"]!, withoutManage()))).rejects.toThrow(/ít nhất một tài khoản/);
    expect(await codesOf(roleId["Giám đốc"]!)).toContain("user.manage");
    expect(await codesOf(roleId["Giám đốc"]!)).toHaveLength(ALL_PERMISSION_CODES.length);
    expect(await auditCount()).toBe(before);
  });

  it("chỉ còn quản trị viên đã bị khoá giữ user.manage → cũng bị chặn", async () => {
    const a = await makeUser("admin", ["Giám đốc"]);
    const custom = await prisma.role.create({ data: { name: "QT phụ" } });
    const um = await prisma.permission.findUniqueOrThrow({ where: { code: "user.manage" } });
    await prisma.rolePermission.create({ data: { roleId: custom.id, permissionId: um.id } });
    await prisma.user.create({ data: { username: "locked", fullName: "L", passwordHash: "x", isLocked: true, roles: { create: { roleId: custom.id } } } });
    await expect(tx((db) => updateRolePermissions(db, asActor(a.id), roleId["Giám đốc"]!, withoutManage()))).rejects.toThrow(/ít nhất một tài khoản/);
  });

  it("còn nhóm khác (đang có người hoạt động) giữ user.manage → gỡ khỏi Giám đốc được", async () => {
    const a = await makeUser("admin", ["Giám đốc"]);
    const custom = await prisma.role.create({ data: { name: "QT phụ" } });
    const um = await prisma.permission.findUniqueOrThrow({ where: { code: "user.manage" } });
    await prisma.rolePermission.create({ data: { roleId: custom.id, permissionId: um.id } });
    await prisma.user.create({ data: { username: "qt", fullName: "QT", passwordHash: "x", roles: { create: { roleId: custom.id } } } });
    await tx((db) => updateRolePermissions(db, asActor(a.id), roleId["Giám đốc"]!, withoutManage()));
    expect(await codesOf(roleId["Giám đốc"]!)).not.toContain("user.manage");
  });

  it("đồng thời: khoá quản trị viên B và gỡ user.manage khỏi nhóm của A → không thể cùng thành công", async () => {
    const custom = await prisma.role.create({ data: { name: "QT phụ" } });
    const um = await prisma.permission.findUniqueOrThrow({ where: { code: "user.manage" } });
    await prisma.rolePermission.create({ data: { roleId: custom.id, permissionId: um.id } });
    const a = await makeUser("admin1", ["Giám đốc"]);
    const b = await prisma.user.create({ data: { username: "b", fullName: "B", passwordHash: "x", roles: { create: { roleId: custom.id } } } });
    for (let i = 0; i < 4; i++) {
      await prisma.user.updateMany({ data: { isLocked: false } });
      await prisma.rolePermission.deleteMany({ where: { roleId: roleId["Giám đốc"]! } });
      await prisma.rolePermission.create({ data: { roleId: roleId["Giám đốc"]!, permissionId: um.id } });
      const rs = await Promise.allSettled([
        tx((db) => setLocked(db, asActor(a.id), b.id, true)),
        tx((db) => updateRolePermissions(db, asActor(a.id), roleId["Giám đốc"]!, withoutManage())),
      ]);
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const holders = await prisma.user.count({
        where: { isLocked: false, roles: { some: { role: { permissions: { some: { permission: { code: "user.manage" } } } } } } },
      });
      expect(holders).toBeGreaterThanOrEqual(1);
    }
  });
});
