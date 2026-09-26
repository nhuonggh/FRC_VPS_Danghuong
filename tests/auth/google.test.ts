import { describe, expect, it, vi } from "vitest";
import { loginErrorMessage } from "@/lib/auth-errors";
import { sameOriginRedirect } from "@/lib/safe-callback";
import { mustChangePasswordApplies } from "@/server/auth/actor";
import {
  GOOGLE_DENY_REDIRECT, decideGoogleSignIn, isGoogleConfigured, toAuthMethod, verifiedGoogleEmail, type GoogleUserRecord,
} from "@/server/auth/google";
import { looksLikeEmail, normalizeEmail } from "@/server/auth/normalize";

// Toàn bộ file: THUẦN — không DB, không mạng. Email/khoá trong file là giá trị giả.
const ADMIN: GoogleUserRecord = { id: 7, fullName: "Quản trị", isLocked: false };
const lookupOf = (rows: Record<string, GoogleUserRecord>) => vi.fn(async (email: string) => rows[email] ?? null);

describe("decideGoogleSignIn (thuần, tra cứu tiêm vào)", () => {
  it("email đã xác minh + khớp user đang hoạt động → cho vào, trả đúng user DB", async () => {
    const lookup = lookupOf({ "boss@example.test": ADMIN });
    expect(await decideGoogleSignIn({ email: "boss@example.test", email_verified: true }, lookup)).toEqual({ ok: true, user: ADMIN });
    expect(lookup).toHaveBeenCalledWith("boss@example.test");
  });

  it("chưa xác minh (false / thiếu / chuỗi 'true' / 1) → từ chối, KHÔNG tra DB", async () => {
    for (const email_verified of [false, undefined, "true", 1, null]) {
      const lookup = lookupOf({ "boss@example.test": ADMIN });
      expect(await decideGoogleSignIn({ email: "boss@example.test", email_verified }, lookup)).toEqual({ ok: false, reason: "UNVERIFIED" });
      expect(lookup).not.toHaveBeenCalled();
    }
  });

  it("email không khớp user nào → UNKNOWN (không tự tạo user)", async () => {
    expect(await decideGoogleSignIn({ email: "la@example.test", email_verified: true }, lookupOf({ "boss@example.test": ADMIN })))
      .toEqual({ ok: false, reason: "UNKNOWN" });
  });

  it("user bị khoá → LOCKED", async () => {
    const lookup = lookupOf({ "boss@example.test": { ...ADMIN, isLocked: true } });
    expect(await decideGoogleSignIn({ email: "boss@example.test", email_verified: true }, lookup)).toEqual({ ok: false, reason: "LOCKED" });
  });

  it("hoa/thường + khoảng trắng: chuẩn hoá trước khi tra (khớp chính xác dạng đã lưu)", async () => {
    const lookup = lookupOf({ "boss@example.test": ADMIN });
    expect((await decideGoogleSignIn({ email: "  Boss@Example.TEST ", email_verified: true }, lookup)).ok).toBe(true);
    expect(lookup).toHaveBeenCalledWith("boss@example.test");
  });

  it("không có claim email (thiếu / rỗng / không phải chuỗi) → NO_EMAIL", async () => {
    for (const email of [undefined, "", "   ", 42, null, ["boss@example.test"]]) {
      const lookup = lookupOf({ "boss@example.test": ADMIN });
      expect(await decideGoogleSignIn({ email, email_verified: true }, lookup)).toEqual({ ok: false, reason: "NO_EMAIL" });
      expect(lookup).not.toHaveBeenCalled();
    }
  });

  it("chỉ có sub/name (trùng tên, trùng id) → vẫn từ chối: không bao giờ khớp theo sub/tên", async () => {
    const lookup = lookupOf({ "boss@example.test": ADMIN });
    const profile = { sub: "7", name: "Quản trị", uid: 7, id: 7, email_verified: true } as Record<string, unknown>;
    expect(await decideGoogleSignIn(profile, lookup)).toEqual({ ok: false, reason: "NO_EMAIL" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("hồ sơ null/undefined → NO_EMAIL", async () => {
    expect(await decideGoogleSignIn(undefined, lookupOf({}))).toEqual({ ok: false, reason: "NO_EMAIL" });
    expect(await decideGoogleSignIn(null, lookupOf({}))).toEqual({ ok: false, reason: "NO_EMAIL" });
  });

  it("verifiedGoogleEmail trả email đã chuẩn hoá", () => {
    expect(verifiedGoogleEmail({ email: " A@B.Test ", email_verified: true })).toEqual({ ok: true, email: "a@b.test" });
  });

  it("redirect khi từ chối = /login?error=GoogleNotAllowed", () => {
    expect(GOOGLE_DENY_REDIRECT).toBe("/login?error=GoogleNotAllowed");
  });
});

describe("isGoogleConfigured", () => {
  it("cần ĐỦ cả hai biến, không rỗng", () => {
    expect(isGoogleConfigured({})).toBe(false);
    expect(isGoogleConfigured({ GOOGLE_CLIENT_ID: "fake-id" })).toBe(false);
    expect(isGoogleConfigured({ GOOGLE_CLIENT_SECRET: "fake-secret" })).toBe(false);
    expect(isGoogleConfigured({ GOOGLE_CLIENT_ID: " ", GOOGLE_CLIENT_SECRET: "fake-secret" })).toBe(false);
    expect(isGoogleConfigured({ GOOGLE_CLIENT_ID: "fake-id", GOOGLE_CLIENT_SECRET: "" })).toBe(false);
    expect(isGoogleConfigured({ GOOGLE_CLIENT_ID: "fake-id", GOOGLE_CLIENT_SECRET: "fake-secret" })).toBe(true);
  });

  it("môi trường test (.env.test) không có Google → tắt", () => {
    expect(isGoogleConfigured()).toBe(false);
  });
});

describe("amr / bắt đổi mật khẩu", () => {
  it("toAuthMethod: chỉ đúng 'google' là Google; còn lại (kể cả thiếu) = password", () => {
    expect(toAuthMethod("google")).toBe("google");
    for (const v of [undefined, null, "password", "GOOGLE", "", 1, {}]) expect(toAuthMethod(v)).toBe("password");
  });

  it("mustChangePasswordApplies: chỉ phiên mật khẩu bị bắt đổi", () => {
    expect(mustChangePasswordApplies(true, "password")).toBe(true);
    expect(mustChangePasswordApplies(true, "google")).toBe(false);
    expect(mustChangePasswordApplies(false, "password")).toBe(false);
    expect(mustChangePasswordApplies(false, "google")).toBe(false);
  });
});

describe("normalizeEmail / looksLikeEmail", () => {
  it("chuẩn hoá trim + chữ thường", () => {
    expect(normalizeEmail("  Nam.Nguyen@Example.TEST\t")).toBe("nam.nguyen@example.test");
  });
  it("looksLikeEmail", () => {
    for (const ok of ["a@b.co", "x.y+z@sub.example.test"]) expect(looksLikeEmail(ok)).toBe(true);
    for (const bad of ["", "a", "a@b", "a b@c.d", "@b.co", "a@.co", "a@b.", `${"a".repeat(250)}@b.co`]) expect(looksLikeEmail(bad)).toBe(false);
  });
});

describe("sameOriginRedirect (callback redirect của next-auth)", () => {
  const base = "https://dherp.example.test";
  it("đường dẫn tương đối → nối vào baseUrl", () => {
    expect(sameOriginRedirect("/sales/orders?tab=2", base)).toBe(`${base}/sales/orders?tab=2`);
  });
  it("cùng origin tuyệt đối → giữ", () => {
    expect(sameOriginRedirect(`${base}/system/users`, base)).toBe(`${base}/system/users`);
  });
  it.each([
    "https://evil.example/x", "//evil.example/x", "http://dherp.example.test/x", "https://dherp.example.test.evil.example/",
    "javascript:alert(1)", "/\\evil.example", "/\t/evil.example", "data:text/html,hi", "https://dherp.example.test:444/",
  ])("URL ngoài / lạ %j → baseUrl", (url) => {
    expect(sameOriginRedirect(url, base)).toBe(base);
  });
});

describe("loginErrorMessage", () => {
  it("GoogleNotAllowed → thông báo tiếng Việt yêu cầu", () => {
    expect(loginErrorMessage("GoogleNotAllowed")).toBe("Tài khoản Google này chưa được cấp quyền vào hệ thống. Liên hệ quản trị viên.");
  });
  it("các mã next-auth có thông báo tiếng Việt, không lộ mã", () => {
    for (const code of ["OAuthSignin", "OAuthCallback", "OAuthCreateAccount", "OAuthAccountNotLinked", "Callback", "AccessDenied", "Configuration", "Verification", "Default", "CredentialsSignin", "LOCKED"]) {
      const m = loginErrorMessage(code)!;
      expect(m).toMatch(/[ạảãáàăâđêôơư]/i); // tiếng Việt
      expect(m).not.toContain(code);
    }
  });
  it("mã lạ / chèn nội dung → thông báo chung, không in lại", () => {
    expect(loginErrorMessage("<script>alert(1)</script>")).toBe("Không đăng nhập được, vui lòng thử lại.");
    expect(loginErrorMessage("toString")).toBe("Không đăng nhập được, vui lòng thử lại.");
    expect(loginErrorMessage("__proto__")).toBe("Không đăng nhập được, vui lòng thử lại.");
  });
  it("không có mã → null", () => {
    expect(loginErrorMessage(undefined)).toBeNull();
    expect(loginErrorMessage("")).toBeNull();
  });
});
