import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyCredentials } from "@/server/auth/credentials";
import { BCRYPT_COST, hashPassword, verifyPassword } from "@/server/auth/password";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

beforeEach(resetDb);

describe("verifyCredentials", () => {
  it("đúng tài khoản + mật khẩu → ok", async () => {
    await makeUser({ username: "nam", fullName: "Nguyễn Nam", passwordHash: await hashPassword("Xuong2026") });
    const r = await verifyCredentials(prisma, "nam", "Xuong2026");
    expect(r).toEqual({ ok: true, user: { id: expect.any(Number), fullName: "Nguyễn Nam" } });
  });

  it("tên đăng nhập không phân biệt hoa thường, bỏ khoảng trắng đầu/cuối", async () => {
    await makeUser({ username: "nam", passwordHash: await hashPassword("Xuong2026") });
    expect((await verifyCredentials(prisma, "  NAM ", "Xuong2026")).ok).toBe(true);
  });

  it("sai mật khẩu hoặc không có tài khoản → INVALID (cùng một lý do)", async () => {
    await makeUser({ username: "nam", passwordHash: await hashPassword("Xuong2026") });
    expect(await verifyCredentials(prisma, "nam", "sai")).toEqual({ ok: false, reason: "INVALID" });
    expect(await verifyCredentials(prisma, "khong-co", "Xuong2026")).toEqual({ ok: false, reason: "INVALID" });
  });

  it("tài khoản bị khoá + đúng mật khẩu → LOCKED; sai mật khẩu vẫn INVALID (không lộ trạng thái)", async () => {
    await makeUser({ username: "nam", isLocked: true, passwordHash: await hashPassword("Xuong2026") });
    expect(await verifyCredentials(prisma, "nam", "Xuong2026")).toEqual({ ok: false, reason: "LOCKED" });
    expect(await verifyCredentials(prisma, "nam", "sai")).toEqual({ ok: false, reason: "INVALID" });
  });

  it("mật khẩu tiếng Việt: hash dạng NFC, gõ dạng NFD (hoặc ngược lại) đều đăng nhập được", async () => {
    const nfc = "Mật khẩu2026".normalize("NFC");
    await makeUser({ username: "nam", passwordHash: await hashPassword(nfc) });
    expect((await verifyCredentials(prisma, "nam", nfc.normalize("NFD"))).ok).toBe(true);
    await prisma.user.update({ where: { username: "nam" }, data: { passwordHash: await hashPassword(nfc.normalize("NFD")) } });
    expect((await verifyCredentials(prisma, "nam", nfc)).ok).toBe(true);
  });

  it("tên đăng nhập gõ dạng NFD vẫn khớp tên NFC trong DB", async () => {
    const name = "nguyễn.nam".normalize("NFC");
    await makeUser({ username: name, passwordHash: await hashPassword("Xuong2026") });
    expect((await verifyCredentials(prisma, ` ${name.normalize("NFD").toUpperCase()} `, "Xuong2026")).ok).toBe(true);
  });

  it("hash giả tính LƯỜI: không băm lúc import, chỉ băm 1 lần rồi nhớ lại", async () => {
    const hashSync = vi.spyOn(bcrypt, "hashSync");
    const hash = vi.spyOn(bcrypt, "hash");
    vi.resetModules();
    const { verifyCredentials: fresh } = await import("@/server/auth/credentials");
    expect(hashSync).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    await fresh(prisma, "khong-co-1", "Sai-mat-khau-1");
    await fresh(prisma, "khong-co-2", "Sai-mat-khau-1");
    expect(hashSync).not.toHaveBeenCalled();
    expect(hash).toHaveBeenCalledTimes(1);
    hashSync.mockRestore();
    hash.mockRestore();
  });

  // Không đo đồng hồ (chập chờn): ghim rằng nhánh "không có user" VẪN chạy một phép so bcrypt
  // thật với hash giả, nên độ trễ cùng bậc với nhánh "có user".
  describe("không lộ tên đăng nhập tồn tại qua độ trễ", () => {
    it("không có user → vẫn so sánh mật khẩu với một hash bcrypt giả (đúng 1 lần)", async () => {
      const real = await hashPassword("Xuong2026");
      await makeUser({ username: "nam", passwordHash: real });
      const spy = vi.fn(verifyPassword);
      const r = await verifyCredentials(prisma, "khong-co", "Sai-mat-khau-1", spy);
      expect(r).toEqual({ ok: false, reason: "INVALID" });
      expect(spy).toHaveBeenCalledTimes(1);
      const [plain, usedHash] = spy.mock.calls[0];
      expect(plain).toBe("Sai-mat-khau-1");
      expect(usedHash).toMatch(/^\$2[aby]\$/); // hash bcrypt hợp lệ
      expect(bcrypt.getRounds(usedHash)).toBe(BCRYPT_COST); // cùng cost với hash thật (đổi cost → hash giả đổi theo)
      expect(usedHash).not.toBe(real);
    });

    it("có user → so sánh với hash thật của user (cùng 1 phép so, không nhánh tắt)", async () => {
      const real = await hashPassword("Xuong2026");
      await makeUser({ username: "nam", passwordHash: real });
      const spy = vi.fn(verifyPassword);
      await verifyCredentials(prisma, "nam", "Sai-mat-khau-1", spy);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][1]).toBe(real);
    });

    it("tài khoản khoá cũng luôn qua phép so bcrypt trước khi trả kết quả", async () => {
      await makeUser({ username: "nam", isLocked: true, passwordHash: await hashPassword("Xuong2026") });
      const spy = vi.fn(verifyPassword);
      await verifyCredentials(prisma, "nam", "sai", spy);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
