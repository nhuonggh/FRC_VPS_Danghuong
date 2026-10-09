import { describe, expect, it } from "vitest";
import { productImportSpec } from "@/server/products/import-spec";

const row = { code: "SP01", name: "Tôn", kind: "Hàng hóa", baseUnit: "md", minStock: "1.000", unit: "kg", factor: "2,4", isCoil: "Không", stopped: "Không", note: "" };
describe("product import", () => {
  it("nhiều đơn vị quy đổi cho một mã = nhiều dòng; khoá riêng từng dòng, cột Tỷ trọng", () => {
    const spec = productImportSpec(); const a = spec.parseRow(row, { groups: new Map() }); const b = spec.parseRow({ ...row, unit: "m2", factor: "1,2" }, { groups: new Map() });
    expect(a.ok && b.ok && spec.keyOf(a.data) !== spec.keyOf(b.data)).toBe(true);
    expect(spec.columns.find((c) => c.key === "factor")?.header).toBe("Tỷ trọng");
  });
  it("có đơn vị quy đổi thì bắt buộc tỷ trọng và ngược lại", () => {
    const spec = productImportSpec();
    expect(spec.parseRow({ ...row, factor: "" }, { groups: new Map() }).ok).toBe(false);
    expect(spec.parseRow({ ...row, unit: "" }, { groups: new Map() }).ok).toBe(false);
  });
  it("đọc dữ liệu D2 theo số Việt Nam", () => { const result = productImportSpec().parseRow(row, { groups: new Map() }); expect(result.ok).toBe(true); if (result.ok) expect(result.data.minStock).toBe("1000"); });
  it("bỏ dòng ngừng bán", () => { const spec = productImportSpec(); const result = spec.parseRow({ ...row, stopped: "Có" }, { groups: new Map() }); expect(result.ok && spec.skipReason?.(result.data)).toContain("Ngừng bán"); });
});
