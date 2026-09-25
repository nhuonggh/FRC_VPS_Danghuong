import { beforeEach, describe, expect, it } from "vitest";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/catalog";
import { ForbiddenError } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { hashPassword } from "@/server/auth/password";
import { createRoleIdempotent } from "@/server/roles/service";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

let actor: Actor;

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } });
  const u = await prisma.user.create({
    data: { username: "admin", fullName: "Admin", passwordHash: await hashPassword("Admin12345"), roles: { create: { roleId: role.id } } },
  });
  actor = { userId: u.id, perms: new Set(ALL_PERMISSION_CODES) };
});

const input = (over = {}) => ({ name: "Trợ lý", description: "Hỗ trợ", ...over });
const keyRows = () => prisma.idempotencyKey.findMany({ where: { scope: "role.create" } });

describe("createRoleIdempotent", () => {
  it("cùng khoá 2 lần (mất phản hồi rồi gửi lại) → 1 nhóm, lần 2 trả CÙNG id, không lỗi 'đã tồn tại'", async () => {
    const first = await createRoleIdempotent(prisma, actor, "rk-1", input());
    const again = await createRoleIdempotent(prisma, actor, "rk-1", input());
    expect(again).toEqual(first);
    expect(await prisma.role.count({ where: { name: "Trợ lý" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "role.create" } })).toBe(1);
  });

  it("bảng idempotency_keys chỉ lưu {id}", async () => {
    const first = await createRoleIdempotent(prisma, actor, "rk-2", input());
    const rows = await keyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.responseJson).toEqual({ id: first.id });
  });

  it("đồng thời cùng khoá → đúng 1 nhóm, mọi lời gọi cùng id", async () => {
    const rs = await Promise.all([1, 2, 3, 4].map(() => createRoleIdempotent(prisma, actor, "rk-3", input())));
    expect(new Set(rs.map((r) => r.id)).size).toBe(1);
    expect(await prisma.role.count({ where: { name: "Trợ lý" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "role.create" } })).toBe(1);
  });

  it("khoá khác nhau, cùng tên → lần sau bị từ chối 409 tiếng Việt (vẫn là kiểm tra trùng tên thật)", async () => {
    await createRoleIdempotent(prisma, actor, "rk-a", input());
    await expect(createRoleIdempotent(prisma, actor, "rk-b", input())).rejects.toMatchObject({ status: 409, message: "Tên nhóm quyền đã tồn tại." });
    expect(await prisma.role.count({ where: { name: "Trợ lý" } })).toBe(1);
  });

  it("thiếu quyền → ForbiddenError ngay cả khi khoá đã dùng", async () => {
    await createRoleIdempotent(prisma, actor, "rk-4", input());
    const weak: Actor = { userId: actor.userId, perms: new Set(["user.view"]) };
    await expect(createRoleIdempotent(prisma, weak, "rk-4", input())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lần đầu thất bại (tên trùng) → không để lại khoá; đổi tên rồi gửi lại cùng khoá chạy bình thường", async () => {
    await expect(createRoleIdempotent(prisma, actor, "rk-5", input({ name: "Kế toán" }))).rejects.toThrow("Tên nhóm quyền đã tồn tại.");
    expect(await keyRows()).toHaveLength(0);
    const ok = await createRoleIdempotent(prisma, actor, "rk-5", input());
    expect(ok.id).toEqual(expect.any(Number));
  });
});
