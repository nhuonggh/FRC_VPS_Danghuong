import { describe, expect, it } from "vitest";
import { canonicalToText, normalizeTyped, pastedToTyped, sameNumber, textToCanonical } from "@/lib/number-input";

const money = { maxFrac: 0, allowNegative: false };
const qty = { maxFrac: 3, allowNegative: false };

describe("normalizeTyped", () => {
  it("gom nghìn bằng dấu chấm", () => {
    expect(normalizeTyped("1000000", 7, money).text).toBe("1.000.000");
    expect(normalizeTyped("999999", 6, money).text).toBe("999.999");
  });
  it("bỏ dấu chấm gõ tay và gom lại; xóa chữ", () => {
    expect(normalizeTyped("1.0000", 6, money).text).toBe("10.000");
    expect(normalizeTyped("12ab3", 5, money).text).toBe("123");
  });
  it("ô tiền bỏ dấu phẩy; ô số lượng giữ 1 dấu phẩy và tối đa 3 số lẻ", () => {
    expect(normalizeTyped("1,5", 3, money).text).toBe("15");
    expect(normalizeTyped("1234,56789", 10, qty).text).toBe("1.234,567");
    expect(normalizeTyped("1,2,3", 5, qty).text).toBe("1,23");
  });
  it("bỏ số 0 đầu, giữ '0,'", () => {
    expect(normalizeTyped("007", 3, money).text).toBe("7");
    expect(normalizeTyped("0,", 2, qty).text).toBe("0,");
  });
  it("đặt con trỏ đúng sau khi chèn dấu chấm", () => {
    expect(normalizeTyped("1234", 4, money)).toEqual({ text: "1.234", caret: 5 });
    expect(normalizeTyped("1.2345", 3, money)).toEqual({ text: "12.345", caret: 2 });
  });
  it("số âm chỉ khi cho phép", () => {
    expect(normalizeTyped("-5", 2, money).text).toBe("5");
    expect(normalizeTyped("-5", 2, { maxFrac: 0, allowNegative: true }).text).toBe("-5");
  });
});

describe("textToCanonical", () => {
  it("đổi về số chuẩn", () => {
    expect(textToCanonical("1.234.567,5")).toBe("1234567.5");
    expect(textToCanonical("5,")).toBe("5");
    expect(textToCanonical("")).toBe("");
    expect(textToCanonical("-")).toBe("");
  });
});

describe("canonicalToText", () => {
  it("hiển thị số ngoài", () => {
    expect(canonicalToText(1000000, money)).toBe("1.000.000");
    expect(canonicalToText("1234.5", qty)).toBe("1.234,5");
    expect(canonicalToText("0.50", qty)).toBe("0,5");
    expect(canonicalToText(0, money)).toBe("0");
    expect(canonicalToText(null, money)).toBe("");
    expect(canonicalToText(NaN, money)).toBe("");
  });
  it("làm tròn half-up theo maxFrac", () => {
    expect(canonicalToText("92592.5926", { maxFrac: 2, allowNegative: false })).toBe("92.592,59");
    expect(canonicalToText("999.9995", qty)).toBe("1.000");
  });
});

describe("sameNumber / pastedToTyped", () => {
  it("so theo số", () => {
    expect(sameNumber("0.50", "0.5")).toBe(true);
    expect(sameNumber("", "0")).toBe(false);
  });
  it("dán kiểu VN và kiểu quốc tế", () => {
    expect(textToCanonical(normalizeTyped(pastedToTyped("1.234.567"), 0, money).text)).toBe("1234567");
    expect(textToCanonical(normalizeTyped(pastedToTyped("1,234,567.5"), 0, qty).text)).toBe("1234567.5");
    expect(textToCanonical(normalizeTyped(pastedToTyped("1.234.567,5 ₫"), 0, qty).text)).toBe("1234567.5");
  });
});
