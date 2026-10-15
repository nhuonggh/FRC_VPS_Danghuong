import { describe, expect, it } from "vitest";
import { priceFromWeight, priceToWeight } from "@/lib/weight-price";

describe("giá theo tỷ trọng", () => {
  it("giá/kg × tỷ trọng = đơn giá/md và ngược lại", () => {
    expect(priceFromWeight(20000, 2.4)).toBe(48000);
    expect(priceToWeight(48000, 2.4)).toBe(20000);
    expect(priceToWeight(50000, 2.4)).toBe(20833.33);
  });
  it("tỷ trọng không hợp lệ ⇒ 0", () => { expect(priceFromWeight(1, 0)).toBe(0); expect(priceToWeight(1, 0)).toBe(0); });
});
