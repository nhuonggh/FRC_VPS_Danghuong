import { describe, expect, it } from "vitest";
import { purchaseInputSchema } from "@/server/purchase/schemas";

const valid = {
  partnerId: 1, date: "2026-09-27", freightCost: 0, note: "",
  lines: [{ productId: 1, qty: 1, unit: "kg", factor: 2.4, purchasePrice: 10_000, rollInfo: "" }],
};

describe("purchaseInputSchema", () => {
  it("accepts a valid document and permits duplicate products", () => {
    expect(purchaseInputSchema.safeParse({ ...valid, lines: [...valid.lines, { ...valid.lines[0], purchasePrice: 12_000 }] }).success).toBe(true);
  });

  it("rejects invalid document inputs", () => {
    const result = purchaseInputSchema.safeParse({ ...valid, freightCost: -1, lines: [] });
    expect(result.success).toBe(false);
  });
});
