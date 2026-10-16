import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone";

describe("normalizePhone", () => {
  it("bỏ ký tự thừa, +84/84 → 0", () => {
    expect(normalizePhone("0349 631.425")).toBe("0349631425");
    expect(normalizePhone("+84 349 631 425")).toBe("0349631425");
    expect(normalizePhone("84349631425")).toBe("0349631425");
  });
  it("không đủ để nhận diện ⇒ rỗng", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("12ab")).toBe("");
    expect(normalizePhone("1234567")).toBe("");
  });
});
