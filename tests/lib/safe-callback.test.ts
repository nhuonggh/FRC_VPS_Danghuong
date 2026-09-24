import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "@/lib/safe-callback";

describe("safeCallbackUrl — chống open redirect sau đăng nhập", () => {
  it.each([
    ["/sales/orders?page=2", "/sales/orders?page=2"],
    ["/", "/"],
    [undefined, "/"],
    ["", "/"],
    ["https://evil.com", "/"],
    ["//evil.com/x", "/"],
    ["/\\evil.com", "/"],
    ["/\t/evil.com", "/"], // trình duyệt bỏ tab → "//evil.com"
    ["/\n/evil.com", "/"],
    ["/a\\b", "/"],
    ["javascript:alert(1)", "/"],
    ["/login", "/"], // không quay về chính trang đăng nhập
    ["/login?callbackUrl=%2F", "/"],
    ["/system/users", "/system/users"],
  ])("%j → %j", (input, out) => {
    expect(safeCallbackUrl(input)).toBe(out);
  });
});
