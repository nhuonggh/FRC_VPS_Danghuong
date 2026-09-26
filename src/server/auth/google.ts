import type { PrismaClient } from "@prisma/client";
import { isPrintableAscii, normalizeEmail } from "./normalize";

/**
 * Đăng nhập Google (thay D-1: Credentials + Google). KHÔNG adapter, KHÔNG tự tạo user, KHÔNG nối tài khoản theo tên/sub:
 * chỉ cho vào khi Google xác nhận email (email_verified === true) VÀ email đó khớp CHÍNH XÁC (sau chuẩn hoá) email mà
 * quản trị viên đã đặt cho một user đang hoạt động. Mọi trường hợp khác → /login?error=GoogleNotAllowed.
 */

/** Mã lỗi trên URL /login?error=… khi từ chối tài khoản Google (một thông báo chung, không lộ lý do cụ thể). */
export const GOOGLE_NOT_ALLOWED = "GoogleNotAllowed";
export const GOOGLE_DENY_REDIRECT = `/login?error=${GOOGLE_NOT_ALLOWED}`;

/** Cách phiên được xác thực — ghi vào JWT (`amr`) để biết có áp "bắt đổi mật khẩu" hay không. */
export type AuthMethod = "password" | "google";

/** Chuẩn hoá giá trị `amr` đọc từ token/phiên: chỉ đúng chuỗi "google" mới là Google; mọi thứ khác (kể cả thiếu) = mật khẩu. */
export const toAuthMethod = (raw: unknown): AuthMethod => (raw === "google" ? "google" : "password");

/** Có bật đăng nhập Google không: CẦN CẢ HAI biến (dev/test/CI chạy không có → chỉ Credentials). */
export function isGoogleConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

/** Hình dạng tối thiểu của hồ sơ OIDC Google mà quyết định cần (claim khác bị bỏ qua — kể cả sub/name). */
export interface GoogleProfileLike {
  email?: unknown;
  email_verified?: unknown;
}

export interface GoogleUserRecord {
  id: number;
  fullName: string;
  isLocked: boolean;
}

export type GoogleDenyReason = "NO_EMAIL" | "UNVERIFIED" | "UNKNOWN" | "LOCKED";
export type GoogleDecision = { ok: true; user: GoogleUserRecord } | { ok: false; reason: GoogleDenyReason };

/**
 * Email đã chuẩn hoá lấy từ hồ sơ Google, hoặc lý do không dùng được. `email_verified` phải là boolean `true`
 * (chuỗi "true" cũng bị từ chối — claim sai kiểu = không tin).
 */
export function verifiedGoogleEmail(profile: GoogleProfileLike | null | undefined):
  | { ok: true; email: string }
  | { ok: false; reason: "NO_EMAIL" | "UNVERIFIED" } {
  const raw = profile?.email;
  if (typeof raw !== "string" || !normalizeEmail(raw)) return { ok: false, reason: "NO_EMAIL" };
  // Claim có ký tự ngoài ASCII in được (Kelvin sign, tab, ký tự điều khiển…) → coi như không có email dùng được
  if (!isPrintableAscii(raw)) return { ok: false, reason: "NO_EMAIL" };
  if (profile?.email_verified !== true) return { ok: false, reason: "UNVERIFIED" };
  return { ok: true, email: normalizeEmail(raw) };
}

/**
 * QUYẾT ĐỊNH cho vào hay không — thuần (chỉ phụ thuộc `profile` và hàm tra cứu được tiêm vào), để unit test không cần DB/mạng.
 * `lookupByEmail` nhận email ĐÃ chuẩn hoá và phải so khớp chính xác (users.email lưu cùng dạng).
 */
export async function decideGoogleSignIn(
  profile: GoogleProfileLike | null | undefined,
  lookupByEmail: (email: string) => Promise<GoogleUserRecord | null>,
): Promise<GoogleDecision> {
  const e = verifiedGoogleEmail(profile);
  if (!e.ok) return e;
  const user = await lookupByEmail(e.email);
  if (!user) return { ok: false, reason: "UNKNOWN" };
  if (user.isLocked) return { ok: false, reason: "LOCKED" };
  return { ok: true, user };
}

/** Tra cứu thật trên DB: khớp chính xác cột users.email (UNIQUE, đã chuẩn hoá). Chỉ lấy đúng 3 cột cần. */
export const prismaEmailLookup =
  (db: Pick<PrismaClient, "user">) =>
  (email: string): Promise<GoogleUserRecord | null> =>
    db.user.findUnique({ where: { email }, select: { id: true, fullName: true, isLocked: true } });
