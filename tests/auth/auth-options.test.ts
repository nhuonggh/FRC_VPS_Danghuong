import type { Account, NextAuthOptions, Profile, Session, User } from "next-auth";
import { decode, encode, type JWT } from "next-auth/jwt";
import { beforeEach, describe, expect, it } from "vitest";
import { buildAuthOptions } from "@/lib/auth";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

// KHÔNG gọi mạng: callback được gọi trực tiếp với hồ sơ/tài khoản Google giả. Mọi "secret" dưới đây là giá trị giả.
const FAKE = {
  GOOGLE_CLIENT_ID: "fake-client-id-123.example",
  GOOGLE_CLIENT_SECRET: "fake-client-secret-XYZ",
  AUTH_SECRET: "fake-auth-secret-for-tests",
};
const ACCESS_TOKEN = "fake-access-token-AAA";
const ID_TOKEN = "fake-id-token-BBB";
const REFRESH_TOKEN = "fake-refresh-token-CCC";

const googleAccount = (): Account => ({
  provider: "google", type: "oauth", providerAccountId: "109876543210",
  access_token: ACCESS_TOKEN, id_token: ID_TOKEN, refresh_token: REFRESH_TOKEN, token_type: "Bearer", scope: "openid email profile",
});
const googleProfile = (over: Record<string, unknown> = {}) =>
  ({ sub: "109876543210", email: "boss@example.test", email_verified: true, name: "Tên Google", picture: "https://img.example.test/p.png", ...over }) as Profile;
// next-auth truyền `user` = profile() của provider: id = sub của Google (KHÔNG phải id DB)
const googleUser = (): User => ({ id: "109876543210", name: "Tên Google", email: "boss@example.test", image: "https://img.example.test/p.png" });

let opts: NextAuthOptions;
const cb = () => opts.callbacks!;
const signIn = (account: Account | null, profile?: Profile) =>
  cb().signIn!({ user: googleUser(), account, profile, email: undefined, credentials: undefined } as never);
const jwt = (args: { token?: JWT; user?: User; account?: Account | null; profile?: Profile }) =>
  cb().jwt!({ token: args.token ?? {}, user: args.user as User, account: args.account ?? null, profile: args.profile, trigger: "signIn" } as never);

beforeEach(async () => {
  await resetDb();
  opts = buildAuthOptions(FAKE, prisma);
});

describe("đăng ký provider", () => {
  it("KHÔNG có biến Google → chỉ Credentials (dev/test/CI y như trước)", () => {
    const o = buildAuthOptions({ AUTH_SECRET: FAKE.AUTH_SECRET }, prisma);
    expect(o.providers.map((p) => p.id)).toEqual(["credentials"]);
  });

  it("thiếu 1 trong 2 biến → vẫn chỉ Credentials", () => {
    expect(buildAuthOptions({ GOOGLE_CLIENT_ID: FAKE.GOOGLE_CLIENT_ID }, prisma).providers.map((p) => p.id)).toEqual(["credentials"]);
    expect(buildAuthOptions({ GOOGLE_CLIENT_SECRET: FAKE.GOOGLE_CLIENT_SECRET }, prisma).providers.map((p) => p.id)).toEqual(["credentials"]);
  });

  it("đủ 2 biến → Credentials + Google; state + PKCE giữ mặc định; không nối tài khoản nguy hiểm; không adapter", () => {
    expect(opts.providers.map((p) => p.id)).toEqual(["credentials", "google"]);
    const g = opts.providers[1] as unknown as { checks?: string[]; options?: Record<string, unknown>; allowDangerousEmailAccountLinking?: boolean };
    expect(g.checks).toEqual(expect.arrayContaining(["pkce", "state"]));
    expect(g.options?.allowDangerousEmailAccountLinking).toBeUndefined();
    expect(g.allowDangerousEmailAccountLinking).toBeUndefined();
    expect(opts.adapter).toBeUndefined();
    expect(opts.session?.strategy).toBe("jwt");
    expect(opts.pages).toEqual({ signIn: "/login", error: "/login" });
  });
});

describe("callback signIn (Google)", () => {
  it("email đã xác minh khớp user đang hoạt động → true", async () => {
    await makeUser({ email: "boss@example.test" });
    expect(await signIn(googleAccount(), googleProfile())).toBe(true);
  });

  it("hoa/thường/khoảng trắng trong claim → vẫn khớp", async () => {
    await makeUser({ email: "boss@example.test" });
    expect(await signIn(googleAccount(), googleProfile({ email: " BOSS@Example.test " }))).toBe(true);
  });

  it.each([
    ["email_verified=false", { email_verified: false }],
    ["thiếu email_verified", { email_verified: undefined }],
    ["email_verified dạng chuỗi", { email_verified: "true" }],
    ["không có claim email", { email: undefined }],
    ["email chưa được gán cho ai", { email: "stranger@example.test" }],
  ])("%s → /login?error=GoogleNotAllowed", async (_n, over) => {
    await makeUser({ email: "boss@example.test" });
    expect(await signIn(googleAccount(), googleProfile(over))).toBe("/login?error=GoogleNotAllowed");
  });

  it("user bị khoá → từ chối", async () => {
    await makeUser({ email: "boss@example.test", isLocked: true });
    expect(await signIn(googleAccount(), googleProfile())).toBe("/login?error=GoogleNotAllowed");
  });

  it("KHÔNG tự tạo user khi từ chối", async () => {
    await signIn(googleAccount(), googleProfile({ email: "new@example.test" }));
    expect(await prisma.user.count()).toBe(0);
  });

  it("trùng TÊN (fullName) nhưng không có email → không khớp", async () => {
    await makeUser({ fullName: "Tên Google" });
    expect(await signIn(googleAccount(), googleProfile())).toBe("/login?error=GoogleNotAllowed");
  });

  it("provider credentials → true (đã kiểm ở authorize)", async () => {
    expect(await signIn({ provider: "credentials", type: "credentials", providerAccountId: "1" })).toBe(true);
  });
});

describe("callback jwt / session", () => {
  it("Google: uid = id user trong DB (tra theo email đã xác minh), BỎ QUA sub/uid của Google; amr=google", async () => {
    await makeUser(); // đẩy id lên để id DB ≠ bất kỳ số nào trong claim
    const u = await makeUser({ email: "boss@example.test", fullName: "Quản trị hệ thống" });
    const token = await jwt({
      token: { name: "Tên Google", email: "boss@example.test", picture: "https://img.example.test/p.png", sub: "109876543210" },
      user: googleUser(), account: googleAccount(), profile: googleProfile({ uid: 1, id: 1 }),
    });
    const t0 = Date.now();
    expect(token).toEqual({ name: "Quản trị hệ thống", sub: String(u.id), uid: u.id, amr: "google", authAt: expect.any(Number) });
    expect(Math.abs((token as { authAt: number }).authAt - t0)).toBeLessThan(5_000); // authAt = lúc đăng nhập, không phải iat
  });

  it("Google: hồ sơ không hợp lệ lọt tới jwt → ném lỗi (phòng thủ lớp 2), không phát token", async () => {
    await makeUser({ email: "boss@example.test" });
    await expect(jwt({ user: googleUser(), account: googleAccount(), profile: googleProfile({ email_verified: false }) })).rejects.toThrow("GoogleNotAllowed");
  });

  it("Credentials: uid từ authorize + amr=password (như trước)", async () => {
    const token = await jwt({ token: { name: "Nam", sub: "5" }, user: { id: "5", name: "Nam" }, account: { provider: "credentials", type: "credentials", providerAccountId: "5" } });
    expect(token).toMatchObject({ uid: 5, amr: "password", sub: "5", name: "Nam" });
    expect(token).not.toHaveProperty("authAt"); // authAt chỉ cho phiên Google
  });

  it("request sau (không account/user) → giữ nguyên token", async () => {
    const t = { uid: 3, amr: "google" as const, name: "X" };
    expect(await jwt({ token: t })).toBe(t);
  });

  it("session: chỉ id + name + amr (không email/ảnh); amr lạ → password", async () => {
    const s = (token: JWT) =>
      cb().session!({ session: { user: { id: 0, name: "cũ", email: "leak@example.test", image: "x" } as never, expires: "2099-01-01" } as Session, token, user: undefined as never, newSession: undefined, trigger: "update" } as never) as Session;
    expect(s({ uid: 9, name: "A", amr: "google", authAt: 123 }).user).toEqual({ id: 9, name: "A", amr: "google", authAt: 123 });
    expect(s({ uid: 9, name: "A" }).user).toEqual({ id: 9, name: "A", amr: "password" });
    expect(s({ uid: 9, name: "A", amr: "admin" as never }).user.amr).toBe("password");
  });

  it("secret/token giả KHÔNG bao giờ xuất hiện trong JWT đã mã hoá, JWT giải mã hay session", async () => {
    await makeUser({ email: "boss@example.test" });
    const token = await jwt({
      token: { name: "Tên Google", email: "boss@example.test", picture: "https://img.example.test/p.png", sub: "109876543210" },
      user: googleUser(), account: googleAccount(), profile: googleProfile(),
    });
    const encoded = await encode({ token, secret: FAKE.AUTH_SECRET });
    const decoded = await decode({ token: encoded, secret: FAKE.AUTH_SECRET });
    const session = await cb().session!({ session: { user: { id: 0 }, expires: "2099-01-01" } as Session, token: decoded!, user: undefined as never, newSession: undefined, trigger: "update" } as never);
    const blob = [encoded, JSON.stringify(decoded), JSON.stringify(session)].join("\n");
    for (const secret of [FAKE.GOOGLE_CLIENT_ID, FAKE.GOOGLE_CLIENT_SECRET, FAKE.AUTH_SECRET, ACCESS_TOKEN, ID_TOKEN, REFRESH_TOKEN, "109876543210", "https://img.example.test/p.png"]) {
      expect(blob).not.toContain(secret);
    }
    expect(Object.keys(decoded!).sort()).toEqual(["amr", "authAt", "exp", "iat", "jti", "name", "sub", "uid"]);
  });
});

describe("callback redirect", () => {
  it("chỉ cùng origin", async () => {
    const r = (url: string) => cb().redirect!({ url, baseUrl: "https://dherp.example.test" });
    expect(await r("/system/users")).toBe("https://dherp.example.test/system/users");
    expect(await r("https://evil.example/phish")).toBe("https://dherp.example.test");
    expect(await r("//evil.example")).toBe("https://dherp.example.test");
  });
});
