import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyCredentials } from "@/server/auth/credentials";
import { hashPassword, verifyPassword } from "@/server/auth/password";
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
      expect(usedHash).toMatch(/^\$2[aby]\$10\$/); // hash bcrypt hợp lệ, cùng cost với hash thật
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
