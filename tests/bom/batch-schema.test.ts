import { describe, expect, it } from "vitest";
import { createBomBatchSchema } from "@/server/bom/schemas";

const input = { productIds: [10, 11], processingTypeIds: [1, 2], validFrom: "2026-10-15", lines: [{ materialProductId: 20, qtyPerUnit: 1.25 }] };
describe("batch BOM validation", () => {
  it("accepts multiple distinct targets and types", () => {
    expect(createBomBatchSchema.parse(input)).toEqual(input);
  });
  it("rejects self-consumption for any selected target", () => {
    expect(createBomBatchSchema.safeParse({ ...input, lines: [{ materialProductId: 11, qtyPerUnit: 1 }] }).success).toBe(false);
  });
  it("rejects duplicate materials, duplicate targets and batches over the limit", () => {
    expect(createBomBatchSchema.safeParse({ ...input, lines: [...input.lines, ...input.lines] }).success).toBe(false);
    expect(createBomBatchSchema.safeParse({ ...input, productIds: [10, 10] }).success).toBe(false);
    expect(createBomBatchSchema.safeParse({ ...input, processingTypeIds: Array.from({ length: 26 }, (_, i) => i + 1) }).success).toBe(false);
  });
});
