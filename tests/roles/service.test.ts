import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";
import { hashPassword } from "@/server/auth/password";
import { createRole, deleteRole, updateRoleInfo, updateRolePermissions } from "@/server/roles/service";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
let actor: Actor;
let directorId: number;

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } });
  directorId = role.id;
  const u = await prisma.user.create({ data: { username: "admin", fullName: "Admin", passwordHash: await hashPassword("Admin12345"), roles: { create: { roleId: role.id } } } });
  actor = { userId: u.id, perms: new Set(ALL_PERMISSION_CODES) };
});

const codesOf = async (roleId: number) =>
  (await prisma.rolePermission.findMany({ where: { roleId }, include: { permission: true } })).map((r) => r.permission.code).sort();

describe("nhóm quyền động", () => {
  it("tạo nhóm mới rỗng; tên trùng bị chặn", async () => {
    const r = await tx((db) => createRole(db, actor, { name: "Trợ lý", description: "Hỗ trợ" }));
    expect(await codesOf(r.id)).toEqual([]);
    await expect(tx((db) => createRole(db, actor, { name: "Trợ lý" }))).rejects.toThrow("Tên nhóm quyền đã tồn tại.");
  });

  it("sao chép quyền từ nhóm khác: nhóm mới có đúng quyền nguồn; audit ghi nguồn", async () => {
    const src = await tx((db) => createRole(db, actor, { name: "Kế toán X" }));
    await tx((db) => updateRolePermissions(db, actor, src.id, ["order.view", "product.view"]));
    const r = await tx((db) => createRole(db, actor, { name: "Kế toán phó", copyFromRoleId: src.id }));
    expect(await codesOf(r.id)).toEqual(["order.view", "product.view"]);
    await tx((db) => updateRolePermissions(db, actor, r.id, ["order.view", "product.view", "profit.view"]));
    expect(await codesOf(src.id)).toEqual(["order.view", "product.view"]); // nhóm nguồn không đổi
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "role.create", entityId: String(r.id) } });
    expect(log.afterJson).toMatchObject({ copyFromRoleId: src.id, permissions: ["order.view", "product.view"] });
  });

  it("sao chép: nhóm nguồn không tồn tại → 404; quyền vượt quyền người tạo → chặn, không tạo nhóm", async () => {
    await expect(tx((db) => createRole(db, actor, { name: "A", copyFromRoleId: 999999 }))).rejects.toMatchObject({ status: 404 });
    const weak: Actor = { userId: actor.userId, perms: new Set(["role.manage", "order.view"]) };
    await expect(tx((db) => createRole(db, weak, { name: "B", copyFromRoleId: directorId }))).rejects.toThrow(/không thể cấp quyền/);
    expect(await prisma.role.count({ where: { name: "B" } })).toBe(0);
  });

  it("đồng thời tạo 2 nhóm cùng tên → 1 thành công, 1 lỗi 'đã tồn tại' (không lỗi hệ thống)", async () => {
    const rs = await Promise.allSettled([
      tx((db) => createRole(db, actor, { name: "Trợ lý" })),
      tx((db) => createRole(db, actor, { name: "Trợ lý" })),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((rs.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409, message: "Tên nhóm quyền đã tồn tại." });
    expect(await prisma.role.count({ where: { name: "Trợ lý" } })).toBe(1);
  });

  it("cập nhật quyền: thay thế toàn bộ; audit có danh sách quyền trước/sau", async () => {
    const r = await tx((db) => createRole(db, actor, { name: "Trợ lý" }));
    await tx((db) => updateRolePermissions(db, actor, r.id, ["order.view", "product.view"]));
    expect(await codesOf(r.id)).toEqual(["order.view", "product.view"]);
    await tx((db) => updateRolePermissions(db, actor, r.id, ["order.view", "cost.view"]));
    const logs = await prisma.auditLog.findMany({ where: { action: "role.set_permissions" }, orderBy: { id: "asc" } });
    expect(logs[1]!.beforeJson).toEqual({ permissions: ["order.view", "product.view"] });
    expect(logs[1]!.afterJson).toEqual({ permissions: ["cost.view", "order.view"] });
  });

  it("mã quyền lạ bị từ chối", async () => {
    const r = await tx((db) => createRole(db, actor, { name: "Trợ lý" }));
    await expect(tx((db) => updateRolePermissions(db, actor, r.id, ["khong.co"]))).rejects.toThrow(/không hợp lệ/);
  });

  it("gỡ user.manage khỏi nhóm của quản trị viên CUỐI CÙNG bị chặn và rollback", async () => {
    const wanted = ALL_PERMISSION_CODES.filter((c) => c !== "user.manage");
    await expect(tx((db) => updateRolePermissions(db, actor, directorId, wanted))).rejects.toThrow(/ít nhất một tài khoản/);
    expect(await codesOf(directorId)).toContain("user.manage");
  });

  it("nhóm hệ thống: không xóa, không đổi tên; nhóm tự tạo: đổi tên được", async () => {
    await expect(tx((db) => deleteRole(db, actor, directorId))).rejects.toThrow(/nhóm hệ thống/);
    await expect(tx((db) => updateRoleInfo(db, actor, directorId, { name: "Sếp" }))).rejects.toThrow(/nhóm hệ thống/);
    const r = await tx((db) => createRole(db, actor, { name: "Trợ lý" }));
    await tx((db) => updateRoleInfo(db, actor, r.id, { name: "Trợ lý kho", description: "x" }));
    expect((await prisma.role.findUniqueOrThrow({ where: { id: r.id } })).name).toBe("Trợ lý kho");
  });

  it("xóa nhóm đang có người dùng bị chặn, nêu số người; nhóm trống xóa được", async () => {
    const r = await tx((db) => createRole(db, actor, { name: "Trợ lý" }));
    const u = await prisma.user.create({ data: { username: "tl", fullName: "TL", passwordHash: "x", roles: { create: { roleId: r.id } } } });
    await expect(tx((db) => deleteRole(db, actor, r.id))).rejects.toThrow("Nhóm quyền đang có 1 người dùng — hãy chuyển họ sang nhóm khác trước.");
    await prisma.userRole.deleteMany({ where: { userId: u.id } });
    await tx((db) => deleteRole(db, actor, r.id));
    expect(await prisma.role.count({ where: { id: r.id } })).toBe(0);
  });

  it("thiếu quyền role.manage → bị từ chối", async () => {
    const weak: Actor = { userId: actor.userId, perms: new Set(["user.manage"]) };
    await expect(tx((db) => createRole(db, weak, { name: "X" }))).rejects.toThrow(/không có quyền/);
  });

  it("audit tạo/xoá nhóm không chứa bí mật; xoá nhóm ghi lại danh sách quyền đã có", async () => {
    const r = await tx((db) => createRole(db, actor, { name: "Trợ lý" }));
    await tx((db) => updateRolePermissions(db, actor, r.id, ["order.view"]));
    await tx((db) => deleteRole(db, actor, r.id));
    const del = await prisma.auditLog.findFirstOrThrow({ where: { action: "role.delete" } });
    expect(del.beforeJson).toEqual({ name: "Trợ lý", permissions: ["order.view"] });
  });
});
