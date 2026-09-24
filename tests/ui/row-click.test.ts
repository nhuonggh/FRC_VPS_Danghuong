// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { shouldNavigateOnRowClick, type RowClickEvent } from "@/components/ui/row-click";

const base = (over: Partial<RowClickEvent> = {}): RowClickEvent => ({
  defaultPrevented: false, button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: null, ...over,
});

describe("shouldNavigateOnRowClick", () => {
  it("click chính thường vào vùng không tương tác → điều hướng", () => {
    expect(shouldNavigateOnRowClick(base())).toBe(true);
  });
  it("đã preventDefault → không", () => {
    expect(shouldNavigateOnRowClick(base({ defaultPrevented: true }))).toBe(false);
  });
  it("đang bôi đen văn bản → không", () => {
    expect(shouldNavigateOnRowClick(base(), "abc")).toBe(false);
    expect(shouldNavigateOnRowClick(base(), "")).toBe(true);
  });
  it.each(["ctrlKey", "metaKey", "shiftKey", "altKey"] as const)("phím bổ trợ %s → không", (k) => {
    expect(shouldNavigateOnRowClick(base({ [k]: true }))).toBe(false);
  });
  it("không phải nút chính → không", () => {
    expect(shouldNavigateOnRowClick(base({ button: 1 }))).toBe(false);
    expect(shouldNavigateOnRowClick(base({ button: 2 }))).toBe(false);
  });
  it.each(["a", "button", "input", "label", "select", "textarea"])("click vào/trong <%s> → không", (tag) => {
    const host = document.createElement(tag);
    const inner = document.createElement("span");
    host.appendChild(inner);
    document.body.appendChild(host);
    expect(shouldNavigateOnRowClick(base({ target: inner }))).toBe(false);
    host.remove();
  });
  it("[role=menuitem] và [data-row-ignore] → không", () => {
    for (const attr of ["role", "data-row-ignore"]) {
      const el = document.createElement("div");
      el.setAttribute(attr, attr === "role" ? "menuitem" : "");
      expect(shouldNavigateOnRowClick(base({ target: el }))).toBe(false);
    }
  });
  it("phần tử tương tác BÊN NGOÀI dòng (currentTarget) không chặn", () => {
    const outer = document.createElement("a");
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    row.appendChild(cell);
    outer.appendChild(row);
    expect(shouldNavigateOnRowClick(base({ target: cell, currentTarget: row }))).toBe(true);
  });
});
