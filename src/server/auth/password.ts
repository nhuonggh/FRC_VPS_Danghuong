import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { MAX_PASSWORD_BYTES, normalizePassword, passwordByteLength } from "./normalize";

export const BCRYPT_COST = 10;

const TOO_LONG = `Mật khẩu tối đa ${MAX_PASSWORD_BYTES} byte (ký tự có dấu chiếm nhiều byte hơn).`;

/** Băm mật khẩu (đã chuẩn hoá NFC). Ném lỗi nếu >72 byte thay vì để bcrypt cắt cụt im lặng. */
export async function hashPassword(plain: string): Promise<string> {
  if (passwordByteLength(plain) > MAX_PASSWORD_BYTES) throw new Error(TOO_LONG);
  return bcrypt.hash(normalizePassword(plain), BCRYPT_COST);
}

/** So khớp (chuẩn hoá NFC như lúc băm). Mật khẩu >72 byte không bao giờ khớp: bcrypt chỉ so 72 byte đầu. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (passwordByteLength(plain) > MAX_PASSWORD_BYTES) return false;
  return bcrypt.compare(normalizePassword(plain), hash);
}

/** Trả thông báo lỗi tiếng Việt, hoặc null nếu hợp lệ. */
export function validatePasswordStrength(plain: string, username?: string): string | null {
  const pw = normalizePassword(plain);
  if (pw.length < 8) return "Mật khẩu tối thiểu 8 ký tự.";
  if (passwordByteLength(pw) > MAX_PASSWORD_BYTES) return TOO_LONG;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Mật khẩu phải có cả chữ và số.";
  if (username && pw.toLowerCase().includes(normalizePassword(username).toLowerCase())) {
    return "Mật khẩu không được chứa tên đăng nhập.";
  }
  return null;
}

// Bỏ ký tự dễ nhầm (0/O, 1/l/I) vì mật khẩu tạm được đọc qua điện thoại cho nhân viên
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generateTempPassword(len = 12): string {
  let out = "";
  do {
    out = Array.from({ length: len }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  } while (validatePasswordStrength(out) !== null);
  return out;
}
