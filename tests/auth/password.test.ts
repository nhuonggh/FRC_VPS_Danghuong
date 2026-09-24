import { describe, expect, it } from "vitest";
import {
  generateTempPassword, hashPassword, validatePasswordStrength, verifyPassword,
} from "@/server/auth/password";

describe("password", () => {
  it("băm rồi kiểm đúng/sai", async () => {
    const h = await hashPassword("Abc12345");
    expect(h).not.toContain("Abc12345");
    expect(await verifyPassword("Abc12345", h)).toBe(true);
    expect(await verifyPassword("abc12345", h)).toBe(false);
  });

  it.each([
    ["Ab1", "Mật khẩu tối thiểu 8 ký tự."],
    ["abcdefgh", "Mật khẩu phải có cả chữ và số."],
    ["12345678", "Mật khẩu phải có cả chữ và số."],
    ["Nam12345", "Mật khẩu không được chứa tên đăng nhập."],
  ])("từ chối mật khẩu yếu %s", (pw, msg) => {
    expect(validatePasswordStrength(pw, "nam")).toBe(msg);
  });

  it("chấp nhận mật khẩu đủ mạnh", () => {
    expect(validatePasswordStrength("Xuong2026", "nam")).toBeNull();
  });

  it("mật khẩu tạm: đủ dài, có chữ + số, không ký tự dễ nhầm, mỗi lần khác nhau", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = generateTempPassword();
      expect(p).toHaveLength(12);
      expect(validatePasswordStrength(p)).toBeNull();
      expect(p).not.toMatch(/[0OIl1]/);
      seen.add(p);
    }
    expect(seen.size).toBe(50);
  });
});
