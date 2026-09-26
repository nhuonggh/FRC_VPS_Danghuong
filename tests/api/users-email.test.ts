import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createUserPOST } from "@/app/api/users/route";
import { PATCH as userSection } from "@/app/api/users/[id]/section-update/route";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

// Route chạy thật trên DB test; chỉ giả lập phiên next-auth.
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
const session = vi.mocked(getServerSession);
const loginAs = (id: number) => session.mockResolvedValue({ user: { id } } as never);

let adminId: number;
let staffId: number;
let roleId: Record<string, number>;

const req = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const post = (body: unknown, key = "k1") => createUserPOST(req("/api/users", "POST", body, { "idempotency-key": key }), undefined);
const patchEmail = (id: number, email: unknown) => userSection(req("/x", "PATCH", { section: "email", email }), ctx(id));
const newUser = (over = {}) => ({ username: "nam", fullName: "Nguyễn Nam", roleIds: [roleId["Bán hàng"]!], ...over });
const snapshot = async () => JSON.stringify([await prisma.user.findMany({ orderBy: { id: "asc" } }), await prisma.auditLog.count()]);

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  session.mockReset();
  roleId = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  adminId = (await prisma.user.create({ data: { username: "admin", fullName: "Admin", passwordHash: "x", roles: { create: { roleId: roleId["Giám đốc"]! } } } })).id;
  staffId = (await prisma.user.create({ data: { username: "nv", fullName: "NV", passwordHash: "x", roles: { create: { roleId: roleId["Bán hàng"]! } } } })).id;
});

describe("POST /api/users với email", () => {
  it("email tuỳ chọn, lưu dạng chuẩn hoá", async () => {
    loginAs(adminId);
    const r = await post(newUser({ email: "  Nam.Nguyen@Example.TEST " }));
    expect(r.status).toBe(200);
    const { id } = await r.json();
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).email).toBe("nam.nguyen@example.test");
  });

  it("email sai định dạng → 400 tiếng Việt kèm fields.email, không tạo", async () => {
    loginAs(adminId);
    const r = await post(newUser({ email: "khong-phai-email" }));
    expect(r.status).toBe(400);
    expect((await r.json()).fields).toEqual({ email: "Email không hợp lệ." });
    expect(await prisma.user.count({ where: { username: "nam" } })).toBe(0);
  });

  it("email trùng → 409 thân thiện kèm fields.email (không 500, không 'Dữ liệu đã tồn tại' chung chung)", async () => {
    loginAs(adminId);
    await patchEmail(staffId, "dup@example.test");
    const r = await post(newUser({ email: "DUP@example.test" }), "k2");
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "Email đã được dùng cho tài khoản khác.", fields: { email: "Email đã được dùng cho tài khoản khác." } });
  });

  it("gửi lại cùng Idempotency-Key → cùng id, không 409 email", async () => {
    loginAs(adminId);
    const a = await (await post(newUser({ email: "x@example.test" }), "same")).json();
    const b = await post(newUser({ email: "x@example.test" }), "same");
    expect(b.status).toBe(200);
    expect((await b.json()).id).toBe(a.id);
  });
});

describe("PATCH /api/users/[id]/section-update section=email", () => {
  it("đặt email → 200, audit có email cũ/mới", async () => {
    loginAs(adminId);
    expect((await patchEmail(staffId, "NV@Example.test")).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: staffId } })).email).toBe("nv@example.test");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.set_email", entityId: String(staffId) } });
    expect(log.beforeJson).toEqual({ email: null });
    expect(log.afterJson).toEqual({ email: "nv@example.test" });
    expect(log.userId).toBe(adminId);
  });

  it("gỡ email bằng chuỗi rỗng → NULL", async () => {
    loginAs(adminId);
    await patchEmail(staffId, "nv@example.test");
    expect((await patchEmail(staffId, "")).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: staffId } })).email).toBeNull();
  });

  it("trùng email user khác → 409 fields.email, DB nguyên vẹn", async () => {
    loginAs(adminId);
    await patchEmail(adminId, "boss@example.test");
    const before = await snapshot();
    const r = await patchEmail(staffId, "boss@example.test");
    expect(r.status).toBe(409);
    expect((await r.json()).fields).toEqual({ email: "Email đã được dùng cho tài khoản khác." });
    expect(await snapshot()).toBe(before);
  });

  it("sai định dạng / thiếu / sai kiểu → 400", async () => {
    loginAs(adminId);
    expect((await patchEmail(staffId, "abc")).status).toBe(400);
    expect((await patchEmail(staffId, undefined)).status).toBe(400);
    expect((await patchEmail(staffId, 12)).status).toBe(400);
  });

  it("không có user.manage → 403, không đổi", async () => {
    loginAs(staffId);
    const before = await snapshot();
    expect((await patchEmail(staffId, "me@example.test")).status).toBe(403);
    expect(await snapshot()).toBe(before);
  });

  it("chưa đăng nhập → 401", async () => {
    session.mockResolvedValue(null);
    expect((await patchEmail(staffId, "me@example.test")).status).toBe(401);
  });

  it("user.manage-only gắn email lên Giám đốc (chiếm tài khoản qua Google) → 403, không đổi", async () => {
    const role = await prisma.role.create({ data: { name: "QL" } });
    const perm = await prisma.permission.findUniqueOrThrow({ where: { code: "user.manage" } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    const ql = (await prisma.user.create({ data: { username: "ql", fullName: "QL", passwordHash: "x", roles: { create: { roleId: role.id } } } })).id;
    loginAs(ql);
    const before = await snapshot();
    const r = await patchEmail(adminId, "ql-google@example.test");
    expect(r.status).toBe(403);
    expect(await snapshot()).toBe(before);
  });

  it("section khác không đổi được email; section email không đổi được họ tên/khoá", async () => {
    loginAs(adminId);
    await userSection(req("/x", "PATCH", { section: "profile", fullName: "Tên mới", email: "sneaky@example.test" }), ctx(staffId));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: staffId } })).email).toBeNull();
    await userSection(req("/x", "PATCH", { section: "email", email: "nv@example.test", fullName: "Hack", isLocked: true }), ctx(staffId));
    const u = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });
    expect(u).toMatchObject({ email: "nv@example.test", fullName: "Tên mới", isLocked: false });
  });
});
