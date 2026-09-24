import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { normalizeUsername } from "@/server/auth/normalize";
import {
  BCRYPT_COST, generateTempPassword, hashPassword, validatePasswordStrength, verifyPassword,
} from "@/server/auth/password";

const NFC = (s: string) => s.normalize("NFC");
const NFD = (s: string) => s.normalize("NFD");

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

  it("băm bằng cost chuẩn BCRYPT_COST", async () => {
    expect(bcrypt.getRounds(await hashPassword("Abc12345"))).toBe(BCRYPT_COST);
  });

  describe("giới hạn 72 byte của bcrypt", () => {
    const MSG = "Mật khẩu tối đa 72 byte (ký tự có dấu chiếm nhiều byte hơn).";

    it("đúng 72 byte ASCII → hợp lệ; 73 byte → từ chối", () => {
      expect(validatePasswordStrength("A1" + "a".repeat(70))).toBeNull();
      expect(validatePasswordStrength("A1" + "a".repeat(71))).toBe(MSG);
    });

    it("tính theo BYTE UTF-8, không theo số ký tự: 30 chữ 'ế' (90 byte) bị từ chối", () => {
      const pw = NFC("ế".repeat(30) + "A1");
      expect(pw.length).toBeLessThan(72);
      expect(validatePasswordStrength(pw)).toBe(MSG);
    });

    it("tính sau khi chuẩn hoá NFC: dạng NFD của mật khẩu 72 byte NFC vẫn hợp lệ", () => {
      const nfc = NFC("ế".repeat(23) + "A12"); // 23*3 + 3 = 72 byte
      expect(Buffer.byteLength(nfc)).toBe(72);
      expect(Buffer.byteLength(NFD(nfc))).toBeGreaterThan(72);
      expect(validatePasswordStrength(nfc)).toBeNull();
      expect(validatePasswordStrength(NFD(nfc))).toBeNull();
    });

    it("hashPassword từ chối >72 byte (không băm cắt cụt im lặng)", async () => {
      await expect(hashPassword("A1" + "a".repeat(71))).rejects.toThrow(/72 byte/);
    });

    it("verifyPassword: mật khẩu dài hơn 72 byte KHÔNG khớp dù 72 byte đầu đúng", async () => {
      const ok = "A1" + "a".repeat(70);
      const h = await hashPassword(ok);
      expect(await verifyPassword(ok, h)).toBe(true);
      expect(await verifyPassword(ok + "x", h)).toBe(false);
    });
  });

  describe("chuẩn hoá NFC hai chiều", () => {
    const base = NFC("Mật khẩu2026");

    it("dữ liệu thử: hai dạng thật sự khác nhau", () => {
      expect(NFD(base)).not.toBe(base);
    });

    it("băm dạng NFC, gõ lại dạng NFD → khớp", async () => {
      expect(await verifyPassword(NFD(base), await hashPassword(base))).toBe(true);
    });

    it("băm dạng NFD, gõ lại dạng NFC → khớp", async () => {
      expect(await verifyPassword(base, await hashPassword(NFD(base)))).toBe(true);
    });

    it("hash cũ (bcrypt thẳng từ chuỗi NFC/ASCII) vẫn dùng được", async () => {
      expect(await verifyPassword(base, await bcrypt.hash(base, BCRYPT_COST))).toBe(true);
      expect(await verifyPassword("Abc12345", await bcrypt.hash("Abc12345", BCRYPT_COST))).toBe(true);
    });

    it("mật khẩu khác thật sự vẫn bị từ chối", async () => {
      expect(await verifyPassword(NFC("Mật khẩu2027"), await hashPassword(base))).toBe(false);
    });

    it("validatePasswordStrength đếm ký tự sau NFC (NFD không giúp qua ngưỡng 8 ký tự)", () => {
      const nfd = NFD(NFC("Ế1ế1ế1")); // 6 ký tự NFC, nhiều hơn 8 code point khi ở dạng NFD
      expect(nfd.length).toBeGreaterThan(8);
      expect(validatePasswordStrength(nfd)).toBe("Mật khẩu tối thiểu 8 ký tự.");
    });

    it("kiểm tra 'chứa tên đăng nhập' cũng theo NFC", () => {
      expect(validatePasswordStrength(NFD(NFC("xNguyễn123")), NFC("nguyễn"))).toBe("Mật khẩu không được chứa tên đăng nhập.");
    });
  });

  it("normalizeUsername: NFC + trim + chữ thường", () => {
    expect(normalizeUsername(NFD(NFC("  NGUYỄN.Nam ")))).toBe(NFC("nguyễn.nam"));
    expect(normalizeUsername("  NAM ")).toBe("nam");
  });
});
