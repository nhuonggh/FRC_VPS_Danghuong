import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openingMoneyColumns } from "@/server/opening/money";
import { openingStockSpec } from "@/server/opening/stock";
import { partnerImportSpec } from "@/server/partners/import-spec";
import { productImportSpec } from "@/server/products/import-spec";
import { CATALOG_SECTIONS } from "@/config/catalog-sections";

// Script Google Sheet gửi khách (docs/infra/intake) phải khớp CHÍNH XÁC tiêu đề cột của bộ nhập Excel — đổi cột ở code mà quên script là hỏng luồng nhập.
const gs = readFileSync("docs/infra/intake/create-intake-workbook.gs", "utf8");
const a = { userId: 0, perms: new Set<string>() };
const heads = (cols: readonly { header: string }[]) => cols.map((c) => c.header);
const has = (h: string) => expect(gs, `thiếu cột “${h}”`).toContain(`h: '${h}'`);
const sheetBlock = (name: string) => { const i = gs.indexOf(`name: '${name}'`); expect(i, name).toBeGreaterThan(-1); return gs.slice(i, gs.indexOf("\n", gs.indexOf("cols:", i)) + 1500); };

describe("script tạo bảng nhập liệu khớp cấu trúc dự án", () => {
  it("khách hàng / NCC (partnerCols_) đúng thứ tự cột của import", () => {
    const block = gs.slice(gs.indexOf("function partnerCols_"), gs.indexOf("function createIntakeWorkbook"));
    const found = [...block.matchAll(/h: '([^']+)'/g)].map((m) => m[1]);
    expect(found).toEqual(heads(partnerImportSpec("customer").columns)); expect(heads(partnerImportSpec("supplier").columns)).toEqual(found);
  });
  it("sản phẩm, tồn kho/NVL, công nợ, quỹ, chiết khấu đúng tiêu đề", () => {
    const order = (name: string, expected: string[]) => { const b = sheetBlock(name); let last = -1; for (const h of expected) { const i = b.indexOf(`h: '${h}'`, last + 1); expect(i, `${name}: ${h}`).toBeGreaterThan(last); last = i; } };
    order("Sản phẩm", heads(productImportSpec().columns));
    order("Tồn kho đầu kỳ", heads(openingStockSpec("stock", { actor: a, force: false }).columns)); order("Tồn NVL đầu kỳ", heads(openingStockSpec("material", { actor: a, force: false }).columns));
    order("Công nợ đầu kỳ", heads(openingMoneyColumns("debt"))); order("Số dư quỹ đầu kỳ", heads(openingMoneyColumns("cash"))); order("Chiết khấu tích lũy", heads(openingMoneyColumns("discount")));
  });
  it("danh mục nền có đủ 8 mục cài đặt danh mục và tên trường khớp", () => {
    for (const s of CATALOG_SECTIONS) { const i = gs.indexOf(`name: '${s.label}'`); expect(i, s.label).toBeGreaterThan(-1); for (const f of s.fields.filter((x) => x.type !== "checkbox" || x.name === "isAssistant")) { if (f.name === "isAssistant") has("Là phụ xe"); else has(f.label); } }
  });
  it("dropdown Loại sản phẩm khớp giá trị import nhận; có sheet hướng dẫn, ngày chốt, dòng ví dụ bị bỏ qua (#)", () => {
    for (const v of ["Hàng hóa", "Nguyên vật liệu", "Thành phẩm", "Phụ kiện"]) expect(gs).toContain(`'${v}'`);
    expect(gs).toContain("'HƯỚNG DẪN'"); expect(gs).toContain("Ngày chốt số đầu kỳ"); expect(gs).toContain("'# ' + c.s");
  });
});
