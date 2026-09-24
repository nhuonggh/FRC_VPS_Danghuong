import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

export const BCRYPT_COST = 10;

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** Trả thông báo lỗi tiếng Việt, hoặc null nếu hợp lệ. */
export function validatePasswordStrength(plain: string, username?: string): string | null {
  if (plain.length < 8) return "Mật khẩu tối thiểu 8 ký tự.";
  if (!/[A-Za-z]/.test(plain) || !/\d/.test(plain)) return "Mật khẩu phải có cả chữ và số.";
  if (username && plain.toLowerCase().includes(username.toLowerCase())) {
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
