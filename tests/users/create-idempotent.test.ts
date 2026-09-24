import { beforeEach, describe, expect, it } from "vitest";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/catalog";
import { ForbiddenError } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { verifyCredentials } from "@/server/auth/credentials";
import { hashPassword } from "@/server/auth/password";
import { createUserIdempotent } from "@/server/users/service";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

let actor: Actor;
let roleId: number;

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } });
  roleId = (await prisma.role.findUniqueOrThrow({ where: { name: "Bán hàng" } })).id;
  const u = await prisma.user.create({
    data: { username: "admin", fullName: "Admin", passwordHash: await hashPassword("Admin12345"), roles: { create: { roleId: role.id } } },
  });
  actor = { userId: u.id, perms: new Set(ALL_PERMISSION_CODES) };
});

const input = (over = {}) => ({ username: "nam", fullName: "Nguyễn Nam", roleIds: [roleId], ...over });
const keyRows = () => prisma.idempotencyKey.findMany({ where: { scope: "user.create" } });

describe("createUserIdempotent (D-10)", () => {
  it("lần đầu trả mật khẩu tạm dùng được; lặp lại cùng khoá → vẫn 1 user, KHÔNG có mật khẩu tạm", async () => {
    const first = await createUserIdempotent(prisma, actor, "key-1", input());
    expect(first.tempPassword).toEqual(expect.any(String));
    expect((await verifyCredentials(prisma, "nam", first.tempPassword!)).ok).toBe(true);

    const again = await createUserIdempotent(prisma, actor, "key-1", input());
    expect(again).toEqual({ id: first.id, tempPassword: null });
    expect(await prisma.user.count({ where: { username: "nam" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "user.create" } })).toBe(1);
  });

  it("bảng idempotency_keys KHÔNG lưu mật khẩu tạm (cũng không hash)", async () => {
    const first = await createUserIdempotent(prisma, actor, "key-2", input());
    const rows = await keyRows();
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(first.tempPassword!);
    expect(text.toLowerCase()).not.toContain("password");
    expect(text).not.toMatch(/\$2[aby]\$/);
    expect(rows[0]!.responseJson).toEqual({ id: first.id });
  });

  it("đồng thời cùng khoá: đúng 1 user, đúng 1 lời gọi nhận được mật khẩu tạm", async () => {
    const rs = await Promise.all([1, 2, 3, 4].map(() => createUserIdempotent(prisma, actor, "key-3", input())));
    expect(await prisma.user.count({ where: { username: "nam" } })).toBe(1);
    expect(new Set(rs.map((r) => r.id)).size).toBe(1);
    expect(rs.filter((r) => r.tempPassword !== null)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "user.create" } })).toBe(1);
    expect(JSON.stringify(await keyRows())).not.toContain(rs.find((r) => r.tempPassword)!.tempPassword!);
  });

  it("khoá khác nhau cho cùng tên đăng nhập → lần sau bị từ chối tiếng Việt, vẫn 1 user", async () => {
    await createUserIdempotent(prisma, actor, "key-a", input());
    await expect(createUserIdempotent(prisma, actor, "key-b", input())).rejects.toThrow("Tên đăng nhập đã tồn tại.");
    expect(await prisma.user.count({ where: { username: "nam" } })).toBe(1);
  });

  it("đồng thời, khoá khác nhau, cùng tên đăng nhập → 1 thành công, 1 lỗi 'đã tồn tại' (không lỗi hệ thống)", async () => {
    const rs = await Promise.allSettled([
      createUserIdempotent(prisma, actor, "k1", input()),
      createUserIdempotent(prisma, actor, "k2", input()),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = rs.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, message: "Tên đăng nhập đã tồn tại." });
    expect(await prisma.user.count({ where: { username: "nam" } })).toBe(1);
  });

  it("thiếu quyền → ForbiddenError ngay cả khi khoá đã dùng (lặp lại không lách được kiểm tra quyền)", async () => {
    await createUserIdempotent(prisma, actor, "key-4", input());
    const weak: Actor = { userId: actor.userId, perms: new Set(["user.view"]) };
    await expect(createUserIdempotent(prisma, weak, "key-4", input())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lần đầu thất bại (vai trò không tồn tại) → không để lại khoá; sửa dữ liệu rồi gửi lại cùng khoá chạy bình thường", async () => {
    await expect(createUserIdempotent(prisma, actor, "key-5", input({ roleIds: [99999] }))).rejects.toThrow(/không hợp lệ/);
    expect(await keyRows()).toHaveLength(0);
    const ok = await createUserIdempotent(prisma, actor, "key-5", input());
    expect(ok.tempPassword).toEqual(expect.any(String));
  });
});
