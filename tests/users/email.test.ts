import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { DomainError, FieldConflictError } from "@/server/http/errors";
import { createUserSchema, emailSectionSchema } from "@/server/users/schemas";
import { verifyCredentials } from "@/server/auth/credentials";
import { changeOwnPassword, createUser, createUserIdempotent, resetPassword, setUserEmail, toStoredEmail } from "@/server/users/service";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);

let admin: Actor;
let roleId: Record<string, number>;

async function userWithCodes(username: string, codes: string[]) {
  const role = await prisma.role.create({ data: { name: `R-${username}` } });
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  const u = await prisma.user.create({ data: { username, fullName: username, passwordHash: "x", roles: { create: { roleId: role.id } } } });
  return { userId: u.id, perms: new Set(codes) } as Actor;
}

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  roleId = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  const gd = await prisma.user.create({ data: { username: "admin", fullName: "Admin", passwordHash: "x", roles: { create: { roleId: roleId["Giám đốc"]! } } } });
  admin = { userId: gd.id, perms: new Set((await prisma.permission.findMany()).map((p) => p.code)) } as Actor;
});

const input = (over = {}) => ({ username: "nam", fullName: "Nguyễn Nam", roleIds: [roleId["Bán hàng"]!], ...over });
const snapshot = async () => JSON.stringify([await prisma.user.findMany({ orderBy: { id: "asc" } }), await prisma.auditLog.count()]);

describe("zod emailSchema", () => {
  it("chuẩn hoá trim + chữ thường; rỗng hợp lệ; sai định dạng → tiếng Việt", () => {
    expect(emailSectionSchema.parse({ email: "  Nam@Example.TEST " }).email).toBe("nam@example.test");
    expect(emailSectionSchema.parse({ email: "" }).email).toBe("");
    for (const bad of ["abc", "a@b", "a b@c.test", "nguyễn@x.test"]) {
      const r = emailSectionSchema.safeParse({ email: bad });
      expect(r.success).toBe(false);
      expect(r.error!.issues[0]!.message).toBe("Email không hợp lệ.");
    }
    expect(createUserSchema.parse(input()).email).toBeUndefined(); // tuỳ chọn khi tạo
  });

  it("toStoredEmail: rỗng/thiếu → null", () => {
    expect(toStoredEmail(undefined)).toBeNull();
    expect(toStoredEmail(null)).toBeNull();
    expect(toStoredEmail("   ")).toBeNull();
    expect(toStoredEmail(" X@Y.test ")).toBe("x@y.test");
  });
});

describe("createUser + email", () => {
  it("lưu email đã chuẩn hoá; audit user.create có email", async () => {
    const r = await tx((db) => createUser(db, admin, input({ email: " Nam@Example.TEST " })));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: r.id } })).email).toBe("nam@example.test");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.create" } });
    expect(log.afterJson).toMatchObject({ email: "nam@example.test" });
  });

  it("không email / chuỗi rỗng → NULL", async () => {
    const a = await tx((db) => createUser(db, admin, input()));
    const b = await tx((db) => createUser(db, admin, input({ username: "lan", email: "" })));
    expect((await prisma.user.findMany({ where: { id: { in: [a.id, b.id] } } })).map((u) => u.email)).toEqual([null, null]);
  });

  it("email trùng (khác hoa/thường) → FieldConflictError 409 kèm fields.email, không tạo gì", async () => {
    await tx((db) => createUser(db, admin, input({ email: "nam@example.test" })));
    const before = await snapshot();
    const e = await tx((db) => createUser(db, admin, input({ username: "nam2", email: "NAM@example.test" }))).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FieldConflictError);
    expect(e).toMatchObject({ status: 409, fields: { email: "Email đã được dùng cho tài khoản khác." } });
    expect(await snapshot()).toBe(before);
  });

  it("2 yêu cầu ĐỒNG THỜI cùng email (khoá idempotency khác) → đúng 1 thành công, bên kia 409 email (không 500)", async () => {
    const results = await Promise.allSettled([
      createUserIdempotent(prisma, admin, "k-a", input({ username: "aa1", email: "race@example.test" })),
      createUserIdempotent(prisma, admin, "k-b", input({ username: "bb2", email: "race@example.test" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rej = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rej.reason).toBeInstanceOf(FieldConflictError);
    expect(await prisma.user.count({ where: { email: "race@example.test" } })).toBe(1);
  });
});

describe("setUserEmail", () => {
  let target: number;
  beforeEach(async () => {
    target = (await tx((db) => createUser(db, admin, input()))).id;
  });

  it("đặt email → lưu chuẩn hoá + audit user.set_email có giá trị cũ/mới", async () => {
    await tx((db) => setUserEmail(db, admin, target, " Nam@Example.test"));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).email).toBe("nam@example.test");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.set_email" } });
    expect(log).toMatchObject({ userId: admin.userId, entity: "User", entityId: String(target), beforeJson: { email: null }, afterJson: { email: "nam@example.test" } });
  });

  it("đổi rồi gỡ email: audit mỗi lần có cũ/mới; gỡ = NULL", async () => {
    await tx((db) => setUserEmail(db, admin, target, "a@example.test"));
    await tx((db) => setUserEmail(db, admin, target, "b@example.test"));
    await tx((db) => setUserEmail(db, admin, target, ""));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target } })).email).toBeNull();
    const logs = await prisma.auditLog.findMany({ where: { action: "user.set_email" }, orderBy: { id: "asc" } });
    expect(logs.map((l) => [l.beforeJson, l.afterJson])).toEqual([
      [{ email: null }, { email: "a@example.test" }],
      [{ email: "a@example.test" }, { email: "b@example.test" }],
      [{ email: "b@example.test" }, { email: null }],
    ]);
  });

  it("không đổi (kể cả khác hoa/thường) → không ghi, không audit (idempotent)", async () => {
    await tx((db) => setUserEmail(db, admin, target, "a@example.test"));
    const before = await snapshot();
    await tx((db) => setUserEmail(db, admin, target, "A@EXAMPLE.test"));
    await tx((db) => setUserEmail(db, admin, target, "a@example.test"));
    expect(await snapshot()).toBe(before);
  });

  it("email đã thuộc user khác → 409 fields.email, không đổi gì", async () => {
    await tx((db) => setUserEmail(db, admin, admin.userId, "boss@example.test"));
    const before = await snapshot();
    const e = await tx((db) => setUserEmail(db, admin, target, "Boss@example.test")).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FieldConflictError);
    expect(await snapshot()).toBe(before);
  });

  it("không có user.manage → Forbidden", async () => {
    const viewer = await userWithCodes("xem", ["user.view"]);
    await expect(tx((db) => setUserEmail(db, viewer, target, "x@example.test"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("CHỐNG CHIẾM TÀI KHOẢN: user.manage-only gắn email (của mình) vào Giám đốc → 403, không đổi, không audit", async () => {
    const ql = await userWithCodes("ql", ["user.manage", "user.view"]);
    const before = await snapshot();
    const e = await tx((db) => setUserEmail(db, ql, admin.userId, "ql-google@example.test")).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).status).toBe(403);
    expect(await snapshot()).toBe(before);
    // Nhóm Bán hàng có quyền ql không có → cũng 403; tài khoản không vượt quyền ql → được phép
    await expect(tx((db) => setUserEmail(db, ql, target, "nam@example.test"))).rejects.toMatchObject({ status: 403 });
    const weak = await prisma.user.create({ data: { username: "weak", fullName: "Weak", passwordHash: "x" } });
    await tx((db) => setUserEmail(db, ql, weak.id, "weak@example.test"));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: weak.id } })).email).toBe("weak@example.test");
  });

  it("user không tồn tại → 404", async () => {
    await expect(tx((db) => setUserEmail(db, admin, 999999, "x@example.test"))).rejects.toMatchObject({ status: 404 });
  });
});

describe("hạn mật khẩu tạm (tạo / cấp lại / tự đổi) + emailChangedAt", () => {
  const near = (d: Date | null, hours: number) => {
    expect(d).not.toBeNull();
    expect(Math.abs(d!.getTime() - (Date.now() + hours * 3600_000))).toBeLessThan(60_000);
  };

  it("tạo user → hạn = bây giờ + 72 giờ; có email → emailChangedAt đặt, không email → NULL", async () => {
    const a = await tx((db) => createUser(db, admin, input({ email: "a@example.test" })));
    const b = await tx((db) => createUser(db, admin, input({ username: "lan" })));
    const [ua, ub] = await Promise.all([a.id, b.id].map((id) => prisma.user.findUniqueOrThrow({ where: { id } })));
    near(ua!.tempPasswordExpiresAt, 72);
    expect(ua!.emailChangedAt).not.toBeNull();
    expect(ub!.emailChangedAt).toBeNull();
  });

  it("mật khẩu tạm hết hạn bị từ chối; cấp lại mật khẩu (reset) đặt lại hạn và mở lại đăng nhập", async () => {
    const { id, tempPassword } = await tx((db) => createUser(db, admin, input()));
    await prisma.user.update({ where: { id }, data: { tempPasswordExpiresAt: new Date(Date.now() - 1000) } });
    expect((await verifyCredentials(prisma, "nam", tempPassword)).ok).toBe(false);
    const r = await tx((db) => resetPassword(db, admin, id));
    near((await prisma.user.findUniqueOrThrow({ where: { id } })).tempPasswordExpiresAt, 72);
    expect((await verifyCredentials(prisma, "nam", r.tempPassword)).ok).toBe(true);
  });

  it("tự đổi mật khẩu → xoá hạn (NULL)", async () => {
    const { id, tempPassword } = await tx((db) => createUser(db, admin, input()));
    await tx((db) => changeOwnPassword(db, { userId: id, perms: new Set() } as Actor, { current: tempPassword, next: "Xuong2026" }));
    const u = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(u).toMatchObject({ mustChangePassword: false, tempPasswordExpiresAt: null });
  });

  it("setUserEmail: đổi/gỡ → emailChangedAt tăng; không đổi giá trị → giữ nguyên", async () => {
    const { id } = await tx((db) => createUser(db, admin, input()));
    await tx((db) => setUserEmail(db, admin, id, "a@example.test"));
    const t1 = (await prisma.user.findUniqueOrThrow({ where: { id } })).emailChangedAt!;
    await tx((db) => setUserEmail(db, admin, id, "A@example.test"));
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).emailChangedAt).toEqual(t1);
    await new Promise((r) => setTimeout(r, 5));
    await tx((db) => setUserEmail(db, admin, id, ""));
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).emailChangedAt!.getTime()).toBeGreaterThan(t1.getTime());
  });
});
