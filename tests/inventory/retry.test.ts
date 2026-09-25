import { describe, expect, it, vi } from "vitest";
import { retryOnDeadlock } from "@/server/inventory/unit-of-work";

describe("retryOnDeadlock", () => {
  it("thử lại khi PostgreSQL báo deadlock, thành công ở lần thứ 3", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      if (++n < 3) throw new Error("Transaction failed due to a write conflict or a deadlock detected");
      return "ok";
    });
    await expect(retryOnDeadlock(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("nhận diện mã P2034 và 40P01", async () => {
    let a = 0;
    await expect(retryOnDeadlock(async () => { if (++a < 2) throw Object.assign(new Error("x"), { code: "P2034" }); return 1; })).resolves.toBe(1);
    let b = 0;
    await expect(retryOnDeadlock(async () => { if (++b < 2) throw Object.assign(new Error("x"), { code: "40P01" }); return 2; })).resolves.toBe(2);
  });

  it("lỗi khác KHÔNG được thử lại", async () => {
    const fn = vi.fn(async () => { throw new Error("Số lượng phải lớn hơn 0."); });
    await expect(retryOnDeadlock(fn)).rejects.toThrow("Số lượng");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("hết số lần thử thì ném lỗi cuối", async () => {
    const fn = vi.fn(async () => { throw new Error("deadlock detected"); });
    await expect(retryOnDeadlock(fn, 3)).rejects.toThrow("deadlock detected");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
