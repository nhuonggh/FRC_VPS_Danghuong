import { describe, expect, it } from "vitest";
import { parseLengthExpr, pricePerM2, pricePerMd, termArea, termNote, termQty } from "@/lib/length-expr";

describe("parseLengthExpr", () => {
  it("tách 7.1*7+6.8*1 thành 2 số hạng", () => {
    expect(parseLengthExpr("7.1*7+6.8*1")).toEqual({ terms: [{ length: 7.1, pieces: 7 }, { length: 6.8, pieces: 1 }] });
  });
  it("chấp nhận dấu phẩy, x, khoảng trắng; số hạng không có số tấm = 1", () => {
    expect(parseLengthExpr(" 7,1 x 2 + 3 ")).toEqual({ terms: [{ length: 7.1, pieces: 2 }, { length: 3, pieces: 1 }] });
  });
  it.each(["", "abc", "7.1*", "7.1*2*3", "0*2", "7.1*0", "7.1*1.5", "1.2345*1", "7.1++2"])("từ chối %j", (s) => {
    expect("error" in parseLengthExpr(s)).toBe(true);
  });
});

describe("tính tôn theo kích thước (ví dụ khách: 7,1 m × 1,08 × 7 = 53,676 m² × 150.000)", () => {
  const t = { length: 7.1, pieces: 7 };
  it("md, m², ghi chú", () => {
    expect(termQty(t)).toBe(49.7);
    expect(termArea(t, 1.08)).toBe(53.676);
    expect(termNote(t, 1.08)).toBe("7,1 m × 1,08 × 7 = 53,676 m²");
  });
  it("tiền theo md khớp tiền theo m²", () => {
    expect(pricePerMd(150000, 1.08)).toBe(162000);
    expect(pricePerM2(162000, 1.08)).toBe(150000);
    expect(termQty(t) * pricePerMd(150000, 1.08)).toBeCloseTo(8_051_400, 2);
  });
});
