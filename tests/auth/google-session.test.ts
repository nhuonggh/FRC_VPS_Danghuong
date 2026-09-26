import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as changePassword } from "@/app/api/account/change-password/route";
import { POST as createUserPOST } from "@/app/api/users/route";
import { loadActor } from "@/server/auth/actor";
import { hashPassword } from "@/server/auth/password";
import { getActor, requireActorApi } from "@/server/auth/session";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

// Phiên next-auth giả lập (amr do server ký trong JWT thật); route + DB chạy thật.
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
const session = vi.mocked(getServerSession);
const loginAs = (id: number, amr?: string) => session.mockResolvedValue({ user: { id, ...(amr ? { amr } : {}) } } as never);

let mcId: number; // Giám đốc đang bị bắt đổi mật khẩu
let gdRole: number;

const post = (key: string) =>
  createUserPOST(new NextRequest("http://localhost/api/users", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ username: `nv${key}`, fullName: "Nhân viên", roleIds: [gdRole] }),
  }), undefined);

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  session.mockReset();
  gdRole = (await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } })).id;
  mcId = (await prisma.user.create({
    data: { username: "mc", fullName: "MC", email: "mc@example.test", passwordHash: await hashPassword("Admin12345"), mustChangePassword: true, roles: { create: { roleId: gdRole } } },
  })).id;
});

describe("loadActor theo cách xác thực", () => {
  it("phiên mật khẩu: mustChangePassword có hiệu lực; phiên Google: không; authMethod phản ánh đúng", async () => {
    expect(await loadActor(prisma, mcId)).toMatchObject({ mustChangePassword: true, authMethod: "password" });
    expect(await loadActor(prisma, mcId, "password")).toMatchObject({ mustChangePassword: true, authMethod: "password" });
    expect(await loadActor(prisma, mcId, "google")).toMatchObject({ mustChangePassword: false, authMethod: "google" });
  });

  it("Google KHÔNG vượt được khoá tài khoản; quyền vẫn đọc từ DB mỗi lần", async () => {
    await prisma.user.update({ where: { id: mcId }, data: { isLocked: true } });
    expect(await loadActor(prisma, mcId, "google")).toBeNull();
    await prisma.user.update({ where: { id: mcId }, data: { isLocked: false } });
    await prisma.userRole.deleteMany({ where: { userId: mcId } });
    expect((await loadActor(prisma, mcId, "google"))!.perms.size).toBe(0);
  });
});

describe("thu hồi đăng nhập Google", () => {
  it("gỡ email → phiên Google hết hiệu lực ngay; phiên mật khẩu không bị ảnh hưởng", async () => {
    await prisma.user.update({ where: { id: mcId }, data: { email: null } });
    expect(await loadActor(prisma, mcId, "google")).toBeNull();
    expect(await loadActor(prisma, mcId, "password")).not.toBeNull();
    loginAs(mcId, "google");
    expect((await post("g3")).status).toBe(401);
  });
});

describe("getActor / requireActorApi với amr trong phiên", () => {
  it("amr=google → actor không bị bắt đổi mật khẩu; thiếu amr (phiên cũ) → như mật khẩu", async () => {
    loginAs(mcId, "google");
    expect(await getActor()).toMatchObject({ authMethod: "google", mustChangePassword: false });
    loginAs(mcId);
    expect(await getActor()).toMatchObject({ authMethod: "password", mustChangePassword: true });
    loginAs(mcId, "GOOGLE");
    expect(await getActor()).toMatchObject({ authMethod: "password", mustChangePassword: true });
  });

  it("requireActorApi: phiên Google của user mustChangePassword dùng được app; phiên mật khẩu bị 403 như cũ", async () => {
    loginAs(mcId, "google");
    await expect(requireActorApi("user.manage")).resolves.toMatchObject({ userId: mcId });
    loginAs(mcId, "password");
    await expect(requireActorApi("user.manage")).rejects.toMatchObject({ status: 403, code: "MUST_CHANGE_PASSWORD" });
  });

  it("route thật: phiên Google tạo được user (200); phiên mật khẩu → 403 'Cần đổi mật khẩu…'", async () => {
    loginAs(mcId, "google");
    expect((await post("g1")).status).toBe(200);
    loginAs(mcId, "password");
    const r = await post("p1");
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("Cần đổi mật khẩu trước khi tiếp tục.");
  });

  it("phiên Google của user bị khoá → 401 (không vượt khoá)", async () => {
    await prisma.user.update({ where: { id: mcId }, data: { isLocked: true } });
    loginAs(mcId, "google");
    expect((await post("g2")).status).toBe(401);
  });

  it("phiên Google vẫn tự nguyện đổi mật khẩu được (cần mật khẩu hiện tại) — cờ mustChangePassword xoá như cũ", async () => {
    loginAs(mcId, "google");
    const r = await changePassword(new NextRequest("http://localhost/x", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ current: "Admin12345", next: "Xuong2026", confirm: "Xuong2026" }),
    }), undefined);
    expect(r.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: mcId } })).mustChangePassword).toBe(false);
  });
});
