/**
 * Đóng gói file khách "OK ds_sanpham.xlsx" (5 sheet) vào prisma/data/product-sync.json cho prisma/seed-products.ts.
 * Khớp sản phẩm theo TÊN với prisma/data/customer-seed.json (mã hệ thống đã sinh ở đó).
 *
 *   npx tsx scripts/build-product-sync.ts --file <xlsx> [--out prisma/data/product-sync.json] [--report <txt>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { normalizeSearch } from "../src/lib/search";

const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const file = arg("file"); const out = arg("out") ?? "prisma/data/product-sync.json"; const reportPath = arg("report");
if (!file) throw new Error("Thiếu --file.");

type Cell = string | number | boolean | Date | null;
const cellValue = (v: ExcelJS.CellValue): Cell => {
  if (v == null) return null;
  if (typeof v === "object" && !(v instanceof Date)) { if ("result" in v) return (v.result as Cell) ?? null; if ("richText" in v) return v.richText.map((t) => t.text).join(""); return null; }
  return v as Cell;
};
const text = (v: Cell | undefined) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
/** Số kiểu VN hoặc kiểu máy ("1,13" | "33.91" | 1.08). */
const num = (v: Cell | undefined): number | null => { const s = text(v).replace(",", "."); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const fmt = (n: number) => String(Number(n.toFixed(4)));

async function main() {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file!);
  const sheet = (i: number) => { const rows: Cell[][] = []; wb.worksheets[i]!.eachRow((r, n) => { if (n > 1) rows.push((r.values as ExcelJS.CellValue[]).slice(1).map(cellValue)); }); return rows; };
  const [main, , links, typeRows, finished] = [sheet(0), sheet(1), sheet(2), sheet(3), sheet(4)];
  const report: string[] = [];
  const seed = JSON.parse(readFileSync("prisma/data/customer-seed.json", "utf8")) as { products: { code: string; name: string; baseUnit: string; group?: string | null }[] };
  const byName = new Map(seed.products.map((p) => [normalizeSearch(p.name), p]));

  const processingTypes = typeRows.filter((r) => text(r[0])).map((r) => ({ name: text(r[0]), ratio: num(r[1]), stockRatio: num(r[2]), unit: text(r[3]).toLowerCase() || null }));
  const typeByKey = new Map(processingTypes.map((t) => [normalizeSearch(t.name), t.name]));
  for (const t of processingTypes) if (!t.ratio || !t.stockRatio) report.push(`Kiểu gia công thiếu tỷ lệ: ${t.name}`);

  const typesOf = new Map<string, string[]>();
  for (const r of links) {
    const name = text(r[0]); if (!name) continue;
    const list: string[] = [];
    for (const part of text(r[1]).split("-").map((x) => x.trim()).filter(Boolean)) { const t = typeByKey.get(normalizeSearch(part)); if (!t) report.push(`Kiểu gia công "${part}" của "${name}" không có trong sheet chi tiết`); else if (!list.includes(t)) list.push(t); }
    typesOf.set(normalizeSearch(name), list);
  }
  const finishedNames = new Set(finished.map((r) => normalizeSearch(text(r[0]))).filter(Boolean));

  const products = main.filter((r) => text(r[1])).map((r) => {
    const name = text(r[1]); const key = normalizeSearch(name); const hit = byName.get(key);
    if (!hit) { report.push(`Sản phẩm không có trong customer-seed.json: ${name}`); return null; }
    const group = text(r[3]).replace(/^Phụ kiên/i, "Phụ kiện") || null;
    const unit = text(r[10]).toLowerCase() || null;
    const thanhPham = text(r[13]).toLowerCase().startsWith("thành phẩm") || finishedNames.has(key);
    const weight = num(r[11]);
    return { code: hit.code, name: hit.name, group, baseUnit: unit, qtyLabel: text(r[5]) && text(r[5]).toLowerCase() !== (unit ?? "") ? text(r[5]).charAt(0).toUpperCase() + text(r[5]).slice(1) : null, kind: thanhPham ? "THANH_PHAM" as const : /^phu kien/.test(normalizeSearch(group ?? "")) ? "PHU_KIEN" as const : "HANG" as const, weight: weight && weight > 0 ? fmt(weight) : null, processing: typesOf.get(key) ?? [] };
  }).filter((p): p is NonNullable<typeof p> => p !== null);
  for (const n of finishedNames) if (!products.some((p) => normalizeSearch(p.name) === n)) report.push(`Thành phẩm không khớp sản phẩm: ${n}`);
  const diffUnit = products.filter((p) => { const o = byName.get(normalizeSearch(p.name))!; return p.baseUnit && p.baseUnit !== o.baseUnit; });
  const diffGroup = products.filter((p) => (p.group ?? null) !== (byName.get(normalizeSearch(p.name))!.group ?? null));
  const kgBase = products.filter((p) => p.weight && (p.baseUnit ?? "") === "kg");
  report.unshift(`Khác đơn vị gốc so với seed cũ: ${diffUnit.length}`, ...diffUnit.slice(0, 40).map((p) => `  ${p.code}: ${byName.get(normalizeSearch(p.name))!.baseUnit} → ${p.baseUnit}`), `Khác nhóm so với seed cũ: ${diffGroup.length}`, `Tỉ trọng nhưng đơn vị gốc là kg (bỏ qua quy đổi): ${kgBase.length}`);
  const units = [...new Set(products.map((p) => p.baseUnit).filter((u): u is string => !!u))].sort((a, b) => a.localeCompare(b, "vi"));
  const productGroups = [...new Set(products.map((p) => p.group).filter((g): g is string => !!g))];

  const lines = (k: string, v: unknown[]) => `  ${JSON.stringify(k)}: [\n${v.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]`;
  writeFileSync(out, `{\n  "version": 1,\n${lines("units", units.map((name) => ({ name })))},\n${lines("productGroups", productGroups.map((name) => ({ name })))},\n${lines("processingTypes", processingTypes)},\n${lines("products", products)}\n}\n`, "utf8");
  console.log(`Đã ghi ${out}: ${products.length} sản phẩm, ${processingTypes.length} kiểu gia công, ${units.length} đơn vị, ${productGroups.length} nhóm; ${products.filter((p) => p.weight).length} có tỉ trọng, ${products.filter((p) => p.processing.length).length} có kiểu gia công, ${products.filter((p) => p.kind === "THANH_PHAM").length} thành phẩm`);
  if (reportPath) writeFileSync(reportPath, report.join("\n"), "utf8"); else console.log(report.slice(0, 30).join("\n"));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
