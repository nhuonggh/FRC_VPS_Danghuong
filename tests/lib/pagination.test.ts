import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, nextSort, PAGE_SIZES, pageWindow } from "@/lib/pagination";

describe("pageWindow", () => {
  it("ít trang: hiện hết", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it("nhiều trang: rút gọn với '…' và luôn có trang đầu/cuối/hiện tại ±1", () => {
    expect(pageWindow(1, 25)).toEqual([1, 2, 3, "…", 25]);
    expect(pageWindow(3, 25)).toEqual([1, 2, 3, 4, "…", 25]);
    expect(pageWindow(12, 25)).toEqual([1, "…", 11, 12, 13, "…", 25]);
    expect(pageWindow(24, 25)).toEqual([1, "…", 23, 24, 25]);
    expect(pageWindow(25, 25)).toEqual([1, "…", 24, 25]);
  });
  it("total = 0 → 1 trang", () => {
    expect(pageWindow(1, 0)).toEqual([1]);
  });
});

describe("nextSort — click header: tăng → giảm → bỏ sort", () => {
  it("chuyển vòng", () => {
    expect(nextSort(undefined, "name")).toBe("name");
    expect(nextSort("name", "name")).toBe("-name");
    expect(nextSort("-name", "name")).toBeUndefined();
    expect(nextSort("code", "name")).toBe("name"); // đổi cột → tăng dần cột mới
  });
});

describe("hằng số", () => {
  it("cỡ trang theo crm-design", () => {
    expect([...PAGE_SIZES]).toEqual([10, 15, 20, 50, 100]);
    expect(DEFAULT_PAGE_SIZE).toBe(20);
  });
});
