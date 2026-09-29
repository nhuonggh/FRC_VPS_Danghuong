import { describe, expect, it } from "vitest";
import { clientIp, createLoginLimiter } from "@/server/auth/rate-limit";

const CFG = { windowMs: 1000, maxPerAccount: 3, maxPerIp: 5 };

describe("loginLimiter", () => {
  it("chặn sau đủ số lần sai theo (IP + tài khoản), tài khoản khác vẫn được", () => {
    const l = createLoginLimiter(CFG, () => 0);
    for (let i = 0; i < 3; i++) { expect(l.isBlocked("1.1.1.1", "an")).toBe(false); l.recordFailure("1.1.1.1", "an"); }
    expect(l.isBlocked("1.1.1.1", "an")).toBe(true);
    expect(l.isBlocked("1.1.1.1", "binh")).toBe(false);
    expect(l.isBlocked("2.2.2.2", "an")).toBe(false);
  });

  it("chặn cả IP khi quét nhiều tài khoản", () => {
    const l = createLoginLimiter(CFG, () => 0);
    for (const u of ["a", "b", "c", "d", "e"]) l.recordFailure("1.1.1.1", u);
    expect(l.isBlocked("1.1.1.1", "moi")).toBe(true);
  });

  it("hết cửa sổ thì mở lại", () => {
    let t = 0;
    const l = createLoginLimiter(CFG, () => t);
    for (let i = 0; i < 3; i++) l.recordFailure("1.1.1.1", "an");
    expect(l.isBlocked("1.1.1.1", "an")).toBe(true);
    t = 1001;
    expect(l.isBlocked("1.1.1.1", "an")).toBe(false);
  });

  it("đăng nhập đúng xoá bộ đếm của cặp", () => {
    const l = createLoginLimiter(CFG, () => 0);
    l.recordFailure("1.1.1.1", "an"); l.recordFailure("1.1.1.1", "an");
    l.recordSuccess("1.1.1.1", "an");
    l.recordFailure("1.1.1.1", "an");
    expect(l.isBlocked("1.1.1.1", "an")).toBe(false);
  });
});

describe("clientIp", () => {
  it("lấy phần tử cuối của X-Forwarded-For (do Caddy thêm)", () => {
    expect(clientIp({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" })).toBe("9.9.9.9");
  });
  it("không có header → unknown", () => {
    expect(clientIp({})).toBe("unknown");
    expect(clientIp(undefined)).toBe("unknown");
  });
});
