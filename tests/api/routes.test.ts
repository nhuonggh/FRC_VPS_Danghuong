import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/catalog";
import { prisma as appPrisma } from "@/lib/prisma";
import { hashPassword } from "@/server/auth/password";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";
import { POST as changePassword } from "@/app/api/account/change-password/route";
import { POST as createRolePOST } from "@/app/api/roles/route";
import { DELETE as deleteRoleRoute } from "@/app/api/roles/[id]/route";
import { PATCH as roleSection } from "@/app/api/roles/[id]/section-update/route";
import { POST as createUserPOST } from "@/app/api/users/route";
import { POST as lockRoute } from "@/app/api/users/[id]/lock/route";
import { POST as resetRoute } from "@/app/api/users/[id]/reset-password/route";
import { PATCH as userSection } from "@/app/api/users/[id]/section-update/route";

// Route handler chạy thật trên DB test; chỉ giả lập phiên đăng nhập của next-auth.
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
const session = vi.mocked(getServerSession);
const loginAs = (id: number | null) => session.mockResolvedValue(id === null ? null : ({ user: { id } } as never));

let adminId: number;
let staffId: number; // chỉ có quyền Bán hàng
let roleId: Record<string, number>;

const req = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  session.mockReset();
  roleId = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  const hash = await hashPassword("Admin12345");
  adminId = (await prisma.user.create({ data: { username: "admin", fullName: "Admin", passwordHash: hash, roles: { create: { roleId: roleId["Giám đốc"]! } } } })).id;
  staffId = (await prisma.user.create({ data: { username: "nv", fullName: "NV", passwordHash: hash, roles: { create: { roleId: roleId["Bán hàng"]! } } } })).id;
});

const newUser = (over = {}) => ({ username: "nam", fullName: "Nguyễn Nam", roleIds: [roleId["Bán hàng"]!], ...over });
const post = (body: unknown, key: string | null = "k1") =>
  createUserPOST(req("/api/users", "POST", body, key ? { "idempotency-key": key } : {}), undefined);

/** Mọi route ghi + hàm gọi chúng — dùng để kiểm 401/403 đồng loạt. */
const WRITE_ROUTES: [string, () => Promise<Response>, string?][] = [
  ["POST /api/users", () => post(newUser())],
  ["PATCH /api/users/[id]/section-update", () => userSection(req("/x", "PATCH", { section: "profile", fullName: "Tên mới" }), ctx(staffId))],
  ["POST /api/users/[id]/lock", () => lockRoute(req("/x", "POST", { locked: true }), ctx(staffId))],
  ["POST /api/users/[id]/reset-password", () => resetRoute(req("/x", "POST"), ctx(staffId))],
  ["POST /api/roles", () => createRolePOST(req("/x", "POST", { name: "Nhóm mới" }), undefined)],
  ["DELETE /api/roles/[id]", () => deleteRoleRoute(req("/x", "DELETE"), ctx(roleId["Bán hàng"]!))],
  ["PATCH /api/roles/[id]/section-update", () => roleSection(req("/x", "PATCH", { section: "info", name: "Nhóm mới" }), ctx(roleId["Bán hàng"]!))],
];

async function snapshot() {
  return JSON.stringify([
    await prisma.user.findMany({ orderBy: { id: "asc" } }),
    await prisma.role.findMany({ orderBy: { id: "asc" } }),
    await prisma.auditLog.count(),
    await prisma.idempotencyKey.count(),
  ]);
}

describe("xác thực & phân quyền của route (JSON, không redirect)", () => {
  it.each(WRITE_ROUTES)("%s: chưa đăng nhập → 401 JSON, không ghi gì", async (_name, call) => {
    loginAs(null);
    const before = await snapshot();
    const r = await call();
    expect(r.status).toBe(401);
    expect(r.headers.get("location")).toBeNull();
    expect((await r.json()).error).toMatch(/hết hạn/);
    expect(await snapshot()).toBe(before);
  });

  it.each(WRITE_ROUTES)("%s: thiếu quyền → 403 JSON, không ghi gì", async (_name, call) => {
    loginAs(staffId);
    const before = await snapshot();
    const r = await call();
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/không có quyền/);
    expect(await snapshot()).toBe(before);
  });

  it("đổi mật khẩu: chưa đăng nhập → 401", async () => {
    loginAs(null);
    const r = await changePassword(req("/x", "POST", { current: "a", next: "b", confirm: "b" }), undefined);
    expect(r.status).toBe(401);
  });

  it("tài khoản đã bị khoá → 401 ngay dù JWT còn hạn (quyền đọc từ DB mỗi request)", async () => {
    await prisma.user.update({ where: { id: adminId }, data: { isLocked: true } });
    loginAs(adminId);
    expect((await post(newUser())).status).toBe(401);
  });
});

describe("POST /api/users", () => {
  it("tạo user: trả id + mật khẩu tạm; lặp lại cùng khoá → cùng id, mật khẩu null; chỉ 1 user", async () => {
    loginAs(adminId);
    const a = await (await post(newUser())).json();
    expect(a.id).toEqual(expect.any(Number));
    expect(a.tempPassword).toEqual(expect.any(String));
    const b = await (await post(newUser())).json();
    expect(b).toEqual({ id: a.id, tempPassword: null });
    expect(await prisma.user.count({ where: { username: "nam" } })).toBe(1);
  });

  it("bảng idempotency_keys KHÔNG chứa mật khẩu tạm; audit cũng không", async () => {
    loginAs(adminId);
    const a = await (await post(newUser())).json();
    const keys = JSON.stringify(await prisma.idempotencyKey.findMany());
    expect(keys).not.toContain(a.tempPassword);
    expect(keys.toLowerCase()).not.toContain("password");
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(a.tempPassword);
  });

  it("thiếu Idempotency-Key → 400 tiếng Việt, không tạo user", async () => {
    loginAs(adminId);
    const r = await post(newUser(), null);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("Thiếu Idempotency-Key.");
    expect(await prisma.user.count({ where: { username: "nam" } })).toBe(0);
  });

  it("dữ liệu sai → 400 tiếng Việt kèm field; không lộ thông báo tiếng Anh", async () => {
    loginAs(adminId);
    const r = await post({ username: "a b", fullName: "", roleIds: [] });
    expect(r.status).toBe(400);
    const b = await r.json();
    expect(Object.keys(b.fields).sort()).toEqual(["fullName", "roleIds", "username"]);
    expect(JSON.stringify(b)).not.toMatch(/Expected|Required|Invalid/);
    expect(b.fields.roleIds).toBe("Chọn ít nhất 1 nhóm quyền.");
  });

  it("body không phải JSON → 400 (không 500)", async () => {
    loginAs(adminId);
    expect((await post("{hỏng")).status).toBe(400);
  });

  it("trùng tên đăng nhập (khoá khác) → 409 tiếng Việt", async () => {
    loginAs(adminId);
    await post(newUser(), "k1");
    const r = await post(newUser({ username: "NAM" }), "k2");
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("Tên đăng nhập đã tồn tại.");
  });

  it("lỗi hệ thống lạ → 500 chung, KHÔNG lộ nội dung lỗi", async () => {
    loginAs(adminId);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tx = vi.spyOn(appPrisma, "$transaction").mockRejectedValueOnce(new Error("kết nối postgres://user:hunter2@db:5432 hỏng"));
    const r = await post(newUser());
    expect(r.status).toBe(500);
    const text = JSON.stringify(await r.json());
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("postgres");
    tx.mockRestore();
    spy.mockRestore();
  });
});

describe("/api/users/[id]/*", () => {
  it("mã không phải số → 400 tiếng Việt", async () => {
    loginAs(adminId);
    const r = await lockRoute(req("/x", "POST", { locked: true }), ctx("abc"));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("Mã không hợp lệ.");
  });

  it("khoá: body sai → 400; user không tồn tại → 404; khoá thường → 200 + audit", async () => {
    loginAs(adminId);
    expect((await lockRoute(req("/x", "POST", { locked: "yes" }), ctx(staffId))).status).toBe(400);
    expect((await lockRoute(req("/x", "POST", { locked: true }), ctx(999999))).status).toBe(404);
    expect((await lockRoute(req("/x", "POST", { locked: true }), ctx(staffId))).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: staffId } })).isLocked).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "user.lock" } })).toBe(1);
  });

  it("tự gỡ vai trò quản trị của quản trị viên cuối cùng → 409 tiếng Việt, DB nguyên vẹn", async () => {
    loginAs(adminId);
    const before = await snapshot();
    const r = await userSection(req("/x", "PATCH", { section: "roles", roleIds: [roleId["Bán hàng"]!] }), ctx(adminId));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/ít nhất một tài khoản/);
    expect(await snapshot()).toBe(before);
  });

  it("tự khoá mình → 409 tiếng Việt", async () => {
    loginAs(adminId);
    const r = await lockRoute(req("/x", "POST", { locked: true }), ctx(adminId));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("Bạn không thể tự khóa tài khoản của mình.");
  });

  it("section-update: profile / roles thành công; section lạ hoặc thiếu → 400; body null → 400", async () => {
    loginAs(adminId);
    expect((await userSection(req("/x", "PATCH", { section: "profile", fullName: "Tên mới" }), ctx(staffId))).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: staffId } })).fullName).toBe("Tên mới");
    expect((await userSection(req("/x", "PATCH", { section: "roles", roleIds: [roleId["Kế toán"]!] }), ctx(staffId))).status).toBe(200);
    expect((await prisma.userRole.findMany({ where: { userId: staffId } })).map((r) => r.roleId)).toEqual([roleId["Kế toán"]]);
    const bad = await userSection(req("/x", "PATCH", { section: "passwordHash", passwordHash: "x" }), ctx(staffId));
    expect(bad.status).toBe(400);
    expect((await userSection(req("/x", "PATCH", {}), ctx(staffId))).status).toBe(400);
    expect((await userSection(req("/x", "PATCH", "null"), ctx(staffId))).status).toBe(400);
    const wrong = await userSection(req("/x", "PATCH", { section: "profile", fullName: "" }), ctx(staffId));
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).fields).toEqual({ fullName: "Nhập họ tên." });
  });

  it("section-update chỉ ghi field của ĐÚNG section (profile không đổi được vai trò)", async () => {
    loginAs(adminId);
    await userSection(req("/x", "PATCH", { section: "profile", fullName: "Tên mới", roleIds: [roleId["Giám đốc"]!], isLocked: true }), ctx(staffId));
    const u = await prisma.user.findUniqueOrThrow({ where: { id: staffId }, include: { roles: true } });
    expect(u.roles.map((r) => r.roleId)).toEqual([roleId["Bán hàng"]]);
    expect(u.isLocked).toBe(false);
  });

  it("cấp lại mật khẩu trả mật khẩu tạm 1 lần; audit không chứa", async () => {
    loginAs(adminId);
    const r = await (await resetRoute(req("/x", "POST"), ctx(staffId))).json();
    expect(r.tempPassword).toEqual(expect.any(String));
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(r.tempPassword);
  });
});

describe("POST /api/account/change-password", () => {
  const body = (over = {}) => ({ current: "Admin12345", next: "Xuong2026", confirm: "Xuong2026", ...over });

  it("chỉ cần đăng nhập (không cần quyền): đổi thành công", async () => {
    loginAs(staffId);
    expect((await changePassword(req("/x", "POST", body()), undefined)).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: staffId } })).mustChangePassword).toBe(false);
  });

  it("nhập lại không khớp → 400 kèm field confirm; sai mật khẩu hiện tại → 409", async () => {
    loginAs(staffId);
    const a = await changePassword(req("/x", "POST", body({ confirm: "khac" })), undefined);
    expect(a.status).toBe(400);
    expect((await a.json()).fields).toEqual({ confirm: "Mật khẩu nhập lại không khớp." });
    const b = await changePassword(req("/x", "POST", body({ current: "sai-mat-khau" })), undefined);
    expect(b.status).toBe(409);
    expect((await b.json()).error).toBe("Mật khẩu hiện tại không đúng.");
  });

  it("mật khẩu mới quá 72 byte → 400 tiếng Việt", async () => {
    loginAs(staffId);
    const long = "A1" + "a".repeat(71);
    const r = await changePassword(req("/x", "POST", body({ next: long, confirm: long })), undefined);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/72 byte/);
  });
});

describe("/api/roles", () => {
  it("tạo nhóm, đổi thông tin, đặt quyền, xoá nhóm trống", async () => {
    loginAs(adminId);
    const { id } = await (await createRolePOST(req("/x", "POST", { name: "Trợ lý" }), undefined)).json();
    expect((await roleSection(req("/x", "PATCH", { section: "info", name: "Trợ lý kho", description: "d" }), ctx(id))).status).toBe(200);
    expect((await roleSection(req("/x", "PATCH", { section: "permissions", codes: ["order.view"] }), ctx(id))).status).toBe(200);
    expect(await prisma.rolePermission.count({ where: { roleId: id } })).toBe(1);
    expect((await deleteRoleRoute(req("/x", "DELETE"), ctx(id))).status).toBe(200);
    expect(await prisma.role.count({ where: { id } })).toBe(0);
  });

  it("tên trống → 400; tên trùng → 409; xoá nhóm hệ thống → 409; section lạ → 400; nhóm không tồn tại → 404", async () => {
    loginAs(adminId);
    expect((await createRolePOST(req("/x", "POST", { name: "" }), undefined)).status).toBe(400);
    expect((await createRolePOST(req("/x", "POST", { name: "Kế toán" }), undefined)).status).toBe(409);
    expect((await deleteRoleRoute(req("/x", "DELETE"), ctx(roleId["Kế toán"]!))).status).toBe(409);
    expect((await roleSection(req("/x", "PATCH", { section: "x" }), ctx(roleId["Kế toán"]!))).status).toBe(400);
    expect((await roleSection(req("/x", "PATCH", { section: "info", name: "Ok" }), ctx(999999))).status).toBe(404);
  });

  it("gỡ user.manage khỏi nhóm của quản trị viên cuối cùng → 409, quyền nguyên vẹn", async () => {
    loginAs(adminId);
    const codes = ALL_PERMISSION_CODES.filter((c) => c !== "user.manage");
    const r = await roleSection(req("/x", "PATCH", { section: "permissions", codes }), ctx(roleId["Giám đốc"]!));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/ít nhất một tài khoản/);
    expect(await prisma.rolePermission.count({ where: { roleId: roleId["Giám đốc"]! } })).toBe(ALL_PERMISSION_CODES.length);
  });
});
