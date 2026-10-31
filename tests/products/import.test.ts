import { describe, expect, it } from "vitest";
import { productImportSpec } from "@/server/products/import-spec";

const row = { code: "SP01", name: "Tôn", kind: "Hàng hóa", baseUnit: "md", minStock: "1.000", unit: "kg", factor: "2,4", isCoil: "Không", stopped: "Không", note: "" };
describe("product import", () => {
  it("nhiều đơn vị quy đổi cho một mã = nhiều dòng; khoá riêng từng dòng, cột Tỷ trọng", () => {
    const spec = productImportSpec(); const a = spec.parseRow(row, { groups: new Map(), types: new Map() }); const b = spec.parseRow({ ...row, unit: "m2", factor: "1,2" }, { groups: new Map(), types: new Map() });
    expect(a.ok && b.ok && spec.keyOf(a.data) !== spec.keyOf(b.data)).toBe(true);
    expect(spec.columns.find((c) => c.key === "factor")?.header).toBe("Tỷ trọng");
  });
  it("có đơn vị quy đổi thì bắt buộc tỷ trọng và ngược lại", () => {
    const spec = productImportSpec();
    expect(spec.parseRow({ ...row, factor: "" }, { groups: new Map(), types: new Map() }).ok).toBe(false);
    expect(spec.parseRow({ ...row, unit: "" }, { groups: new Map(), types: new Map() }).ok).toBe(false);
  });
  it("cột Giá nhập: đọc số Việt Nam, trống = không đổi, âm hoặc không có quyền = lỗi", () => {
    const ctx = { groups: new Map(), types: new Map() }; const spec = productImportSpec();
    const ok = spec.parseRow({ ...row, purchasePrice: "18.500,5" }, ctx); expect(ok.ok && ok.data.purchasePrice).toBe("18500.5");
    const blank = spec.parseRow({ ...row, purchasePrice: "" }, ctx); expect(blank.ok && blank.data.purchasePrice).toBeNull();
    expect(spec.parseRow({ ...row, purchasePrice: "-1" }, ctx).ok).toBe(false);
    expect(productImportSpec({ canPrice: false }).parseRow({ ...row, purchasePrice: "100" }, ctx).ok).toBe(false);
    expect(productImportSpec({ canPrice: false }).parseRow({ ...row, purchasePrice: "" }, ctx).ok).toBe(true);
  });
  it("đọc dữ liệu D2 theo số Việt Nam", () => { const result = productImportSpec().parseRow(row, { groups: new Map(), types: new Map() }); expect(result.ok).toBe(true); if (result.ok) expect(result.data.minStock).toBe("1000"); });
  it("bỏ dòng ngừng bán", () => { const spec = productImportSpec(); const result = spec.parseRow({ ...row, stopped: "Có" }, { groups: new Map(), types: new Map() }); expect(result.ok && spec.skipReason?.(result.data)).toContain("Ngừng bán"); });
  it("cột Kiểu gia công: nhiều kiểu cách nhau dấu ;, không phân biệt dấu; kiểu lạ báo lỗi", () => {
    const spec = productImportSpec(); const ctx = { groups: new Map(), types: new Map([["ton xop,11 song", 7], ["can song", 9]]) };
    const ok = spec.parseRow({ ...row, processing: "Tôn xốp,11 sóng; Cán sóng; tôn xốp,11 sóng" }, ctx);
    expect(ok.ok && ok.data.processing).toEqual([7, 9]);
    const bad = spec.parseRow({ ...row, processing: "Không có" }, ctx);
    expect(bad.ok).toBe(false);
    const none = spec.parseRow(row, ctx);
    expect(none.ok && none.data.processing).toEqual([]);
  });
});

describe("product capability import", () => {
  const ctx = { groups: new Map<string, number>(), types: new Map<string, number>() };
  it("reads explicit flags, rejects invalid booleans and leaves old templates unspecified", () => {
    const spec = productImportSpec();
    const explicit = spec.parseRow({ ...row, canSell: "Không", canUseAsMaterial: "Có", canProduce: "Có" }, ctx);
    expect(explicit.ok && explicit.data).toMatchObject({ canSell: false, canUseAsMaterial: true, canProduce: true });
    const old = spec.parseRow(row, ctx);
    expect(old.ok && old.data.canUseAsMaterial).toBeUndefined();
    expect(spec.parseRow({ ...row, canSell: "không hợp lệ" }, ctx).ok).toBe(false);
  });
});
