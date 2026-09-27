import { describe, expect, it } from "vitest";
import { convertToBase, resolveFactor } from "@/server/products/units";

describe("product units", () => {
  it("quy đổi D-12 và làm tròn 3 số lẻ", () => {
    expect(convertToBase("3000", "2.4").toString()).toBe("1250");
    expect(convertToBase("1000", "3").toString()).toBe("333.333");
    expect(convertToBase("2", "3").toString()).toBe("0.667");
  });
  it("từ chối số âm và hệ số không dương", () => {
    expect(() => convertToBase(1, 0)).toThrow("Hệ số quy đổi phải lớn hơn 0.");
    expect(() => convertToBase(-1, 2)).toThrow("Số lượng không được âm.");
  });
  it("đơn vị gốc có hệ số 1", () => expect(resolveFactor({ baseUnit: "md", units: [] }, "md").toString()).toBe("1"));
});
