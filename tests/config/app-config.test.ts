import { describe, expect, it } from "vitest";
import { APP_NAV } from "@/config/app.config";
import { ICONS } from "@/components/shell/icons";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/catalog";

const functions = APP_NAV.flatMap((m) => m.categories.flatMap((c) => c.functions));

describe("app.config", () => {
  it("key module/function duy nhất", () => {
    const keys = [...APP_NAV.map((m) => m.key), ...functions.map((f) => f.key)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("path duy nhất và bắt đầu bằng '/'", () => {
    const paths = functions.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p.startsWith("/")).toBe(true);
  });

  it("mọi icon có trong bảng ICONS (không ô trống trong menu)", () => {
    const names = new Set([...APP_NAV.map((m) => m.icon), ...functions.map((f) => f.icon)]);
    for (const n of names) expect(ICONS[n], n).toBeDefined();
  });

  it("perm tham chiếu mã quyền có thật", () => {
    for (const f of functions) if (f.perm) expect(ALL_PERMISSION_CODES).toContain(f.perm);
    for (const m of APP_NAV) if (m.perm) expect(ALL_PERMISSION_CODES).toContain(m.perm);
  });

  it("module flat có path và không có category; module accordion có category", () => {
    for (const m of APP_NAV) {
      if (m.type === "flat") {
        expect(m.path).toBeTruthy();
        expect(m.categories).toHaveLength(0);
      } else {
        expect(m.categories.length).toBeGreaterThan(0);
      }
    }
  });

  it("phủ đủ mã phạm vi màn hình 1–73 + K1–K5 (truy vết spec)", () => {
    const covered = new Set([...functions.flatMap((f) => f.codes), ...APP_NAV.flatMap((m) => m.codes ?? [])]);
    const expected = [
      ...Array.from({ length: 73 }, (_, i) => String(i + 1)),
      "34a", "34b", "34c", "K1", "K2", "K3", "K4", "K5",
    ];
    // mã 1 (Đăng nhập) là màn ngoài menu → gắn ở function user-list; mã 7 (Trang chủ) gắn ở module home
    const missing = expected.filter((c) => !covered.has(c));
    expect(missing).toEqual([]);
  });
});
