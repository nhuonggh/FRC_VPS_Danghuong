import { describe, expect, it } from "vitest";
import { productImportSpec } from "@/server/products/import-spec";

const row = { code: "SP01", name: "Tôn", kind: "Hàng hóa", baseUnit: "md", minStock: "1.000", unit: "kg", factor: "2,4", isCoil: "Không", stopped: "Không", note: "" };
describe("product import", () => {
  it("đọc dữ liệu D2 theo số Việt Nam", () => { const result = productImportSpec().parseRow(row, undefined); expect(result.ok).toBe(true); if (result.ok) expect(result.data.minStock).toBe("1000"); });
  it("bỏ dòng ngừng bán", () => { const spec = productImportSpec(); const result = spec.parseRow({ ...row, stopped: "Có" }, undefined); expect(result.ok && spec.skipReason?.(result.data)).toContain("Ngừng bán"); });
});
