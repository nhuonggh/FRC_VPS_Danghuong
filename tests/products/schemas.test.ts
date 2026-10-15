import { describe, expect, it } from "vitest";
import { createProductSchema } from "@/server/products/schemas";

const valid = { code: "SP-01", name: "Tôn", kind: "HANG" as const, baseUnit: "md", minStock: 0, isCoil: false, isActive: true, note: "", units: [{ unit: "kg", factor: 2.4 }] };
describe("product schemas", () => {
  it("nhận dữ liệu hợp lệ", () => expect(createProductSchema.safeParse(valid).success).toBe(true));
  it("chặn đơn vị trùng", () => expect(createProductSchema.safeParse({ ...valid, units: [{ unit: "KG", factor: 1 }, { unit: "kg", factor: 2 }] }).success).toBe(false));
  it("chặn đơn vị gốc ở quy đổi", () => expect(createProductSchema.safeParse({ ...valid, units: [{ unit: "md", factor: 1 }] }).success).toBe(false));
});
