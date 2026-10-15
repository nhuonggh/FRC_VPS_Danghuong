import { describe, expect, it } from "vitest";
import { buildProcessingRows, buildProductRows, fixPhone, parseLegacyExport, sanitizeCode } from "../../scripts/lib/customer-data";

const cells = (values: string[]) => `<tr>${values.map((v) => `<td>${v}</td>`).join("")}</tr>`;
const html = `<table><thead><tr><th>ID SP</th><th>Tên</th><th>Mã</th></tr></thead><tbody>
${cells(["10", "Trụ kính &amp; nhôm", "tkkhkn", "", "1", "", "True", "", "", "", "Cái", "", "", "275000.00", "295000.00", "", "SanPham", "HangHoa,NguyenVatLieu"])}
${cells(["11", "V Tôn góc 38*38", "Vtgd38*38", "", "1", "", "True", "", "", "", "Cây", "", "", "0.00", "0.00", "", "SanPham", "HangHoa"])}
${cells(["12", "Vách ngăn 5cm", "vnmt5cg", "", "1", "", "True", "", "", "", "m", "", "", "0.00", "0.00", "", "SanPham", "HangHoa"])}
${cells(["12", "Kiểu gia công", "", "", "", "", "Khổ 1.17", "1.0000", "1.1700", "m2", "", "", "108000.0000", "116000.00"])}
</tbody></table>`;

describe("chuyển dữ liệu khách", () => {
  it("đọc file xuất phần mềm cũ: tách sản phẩm và dòng kiểu gia công", () => {
    const r = parseLegacyExport(html);
    expect(r.products.map((p) => p.code)).toEqual(["tkkhkn", "Vtgd38*38", "vnmt5cg"]);
    expect(r.products[0]).toMatchObject({ name: "Trụ kính & nhôm", unit: "Cái", buyPrice: 275000, sellPrice: 295000, active: true });
    expect(r.processing).toEqual([{ productLegacyId: "12", name: "Khổ 1.17", stockRatio: 1, ratio: 1.17, unit: "m2", buyPrice: 108000, sellPrice: 116000 }]);
  });

  it("mã hợp lệ: bỏ dấu, * → X, không trùng", () => {
    const used = new Set<string>();
    expect(sanitizeCode("Kínhdánxk", used)).toBe("KINHDANXK");
    expect(sanitizeCode("Vtgd38*38", used)).toBe("VTGD38X38");
    expect(sanitizeCode("vtgd38x38", used)).toBe("VTGD38X38-2");
    expect(sanitizeCode("a b/ü", new Set())).toMatch(/^[A-Z0-9._\-/]+$/);
  });

  it("gộp sản phẩm: trùng tên giữ dòng khách điền, giá cũ vào ghi chú, kiểu gia công theo sản phẩm", () => {
    const legacy = parseLegacyExport(html);
    const intake = [["SP00001", "Trụ kính & nhôm", "Phụ kiện", "Cái", 5, null, 1, null, null, "ghi chú khách"]];
    const r = buildProductRows(intake, legacy);
    expect(r.overlapByName).toBe(1); expect(r.rows).toHaveLength(3);
    expect(r.rows[0]![0]).toBe("SP00001"); expect(r.rows[0]![2]).toBe("Phụ kiện");
    expect(String(r.rows[0]![9])).toContain("ghi chú khách"); expect(String(r.rows[0]![9])).toContain("giá nhập 275.000");
    expect(r.rows[1]![0]).toBe("VTGD38X38"); expect(r.rows[1]![2]).toBe("Hàng hóa"); expect(r.rows[1]![9]).toBeNull();
    expect(String(r.rows[2]![9])).toContain("Khổ 1.17 (×1,17 m2)");
    expect(r.codeChanges).toEqual([{ legacy: "Vtgd38*38", code: "VTGD38X38" }]);
  });

  it("kiểu gia công: ưu tiên bảng khách, tên chỉ có ở phần mềm cũ được bổ sung", () => {
    const g = { productLegacyId: "1", stockRatio: 1, ratio: 1, unit: "m", buyPrice: 0, sellPrice: 0 };
    const rows = buildProcessingRows([["Khổ 1.17", 1.17, 1, "m2"]], [{ ...g, name: "khổ 1.17", ratio: 9 }, { ...g, name: "Xối" }]);
    expect(rows[0]).toEqual(["Khổ 1.17", null, 1.17, 1, "m2"]); expect(rows[1]).toEqual(["Xối", null, "1", "1", "m"]); expect(rows).toHaveLength(2);
  });

  it("điện thoại bị Excel làm mất số 0 đầu được thêm lại", () => {
    expect(fixPhone(976442950)).toBe("0976442950"); expect(fixPhone("0912345678")).toBe("0912345678"); expect(fixPhone("0000")).toBe("0000"); expect(fixPhone(null)).toBe("");
  });
});
