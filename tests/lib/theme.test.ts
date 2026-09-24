// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, NO_FOUC_SCRIPT, readTheme, safeLocalStorage } from "@/lib/theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme", () => {
  it("readTheme: giá trị lạ/không có → 'system'", () => {
    expect(readTheme(localStorage)).toBe("system");
    localStorage.setItem("theme", "xyz");
    expect(readTheme(localStorage)).toBe("system");
    localStorage.setItem("theme", "dark");
    expect(readTheme(localStorage)).toBe("dark");
  });

  it("applyTheme dark/light: set attribute + lưu; system: gỡ attribute + xoá lưu", () => {
    applyTheme("dark", document.documentElement, localStorage);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    applyTheme("system", document.documentElement, localStorage);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("theme")).toBeNull();
  });

  it("script chống FOUC áp theme đã lưu TRƯỚC khi paint và không ném lỗi khi localStorage hỏng", () => {
    localStorage.setItem("theme", "dark");
    new Function(NO_FOUC_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    document.documentElement.removeAttribute("data-theme");
    const spy = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); }, configurable: true });
    expect(() => new Function(NO_FOUC_SCRIPT)()).not.toThrow();
    Object.defineProperty(window, "localStorage", spy);
  });
  it("storage bị chặn (Safari private / quyền): không ném lỗi, theme vẫn áp cho phiên hiện tại", () => {
    const blocked = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
    };
    expect(readTheme(blocked)).toBe("system");
    expect(() => applyTheme("dark", document.documentElement, blocked)).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(() => applyTheme("system", document.documentElement, blocked)).not.toThrow();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("safeLocalStorage: trả storage giả khi truy cập window.localStorage ném lỗi", () => {
    const orig = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { get() { throw new Error("SecurityError"); }, configurable: true });
    try {
      const s = safeLocalStorage();
      expect(readTheme(s)).toBe("system");
      expect(() => applyTheme("light", document.documentElement, s)).not.toThrow();
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    } finally {
      Object.defineProperty(window, "localStorage", orig);
    }
  });
});
