import ExcelJS from "exceljs";
import { normalizeSearch } from "../../src/lib/search";

/** Hàm thuần dùng cho scripts/seed-customer-data.ts: đọc bảng nhập của khách + file xuất phần mềm cũ, đổi sang cột đúng mẫu nhập của hệ thống. */
export type Row = (string | number | null)[];

const decode = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** 1234.5 → "1.234,5" (số kiểu VN, đúng cái parseViNumber đọc được). */
export const fmtVi = (n: number, maxFrac = 4) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: maxFrac }).format(n);

export interface LegacyProcessing { productLegacyId: string; name: string; stockRatio: number; ratio: number; unit: string; buyPrice: number; sellPrice: number }
export interface LegacyProduct { legacyId: string; name: string; code: string; unit: string; kinds: string; active: boolean; buyPrice: number; sellPrice: number }

export function parseLegacyExport(html: string): { products: LegacyProduct[]; processing: LegacyProcessing[] } {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => decode(c[1]!)));
  const products: LegacyProduct[] = []; const processing: LegacyProcessing[] = [];
  for (const r of rows.slice(1)) {
    if (r[1] === "Kiểu gia công") { processing.push({ productLegacyId: r[0]!, name: r[6] ?? "", stockRatio: num(r[7] ?? ""), ratio: num(r[8] ?? ""), unit: r[9] ?? "", buyPrice: num(r[12] ?? ""), sellPrice: num(r[13] ?? "") }); continue; }
    if (!r[2]) continue; // dòng không có mã sản phẩm (không phải sản phẩm)
    products.push({ legacyId: r[0]!, name: r[1]!, code: r[2], unit: r[10] ?? "", kinds: r[17] ?? "", active: r[4] === "1", buyPrice: num(r[13] ?? ""), sellPrice: num(r[14] ?? "") });
  }
  return { products, processing };
}

/** Mã hệ thống chỉ nhận A-Z 0-9 . _ - / (≤ 30). Bỏ dấu, `*`→X, ký tự lạ→`-`; trùng thì thêm hậu tố -2, -3… */
export function sanitizeCode(raw: string, used: Set<string>): string {
  const base = (normalizeSearch(raw).toUpperCase().replace(/\*/g, "X").replace(/\s+/g, "").replace(/[^A-Z0-9._\-/]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "SP").slice(0, 26);
  let code = base; for (let i = 2; used.has(code); i++) code = `${base}-${i}`;
  used.add(code); return code;
}

export interface ProductSheetResult { rows: Row[]; fromLegacy: number; fromIntake: number; overlapByName: number; codeChanges: { legacy: string; code: string }[]; zeroPrice: number; codeByLegacyId: Map<string, string> }
export const PRODUCT_HEADERS = ["Mã", "Tên", "Loại", "Đơn vị gốc", "Định mức tồn", "Đơn vị quy đổi", "Hệ số quy đổi", "Tôn cuộn", "Ngừng bán", "Ghi chú"] as const;

const priceNote = (p: LegacyProduct) => (p.buyPrice || p.sellPrice ? ["[PM cũ]", p.buyPrice ? `giá nhập ${fmtVi(p.buyPrice)}` : "", p.sellPrice ? `giá bán ${fmtVi(p.sellPrice)}` : ""].filter(Boolean).join(" ") : "");

/**
 * Gộp sản phẩm khách điền tay (`intake`, giữ nguyên mã/loại) với danh sách phần mềm cũ.
 * Trùng TÊN (không dấu) ⇒ giữ dòng khách điền (có phân loại), chỉ ghi thêm giá cũ vào Ghi chú.
 * Phần mềm cũ không phân loại được thành phẩm/NVL ⇒ mọi mã nhập loại "Hàng hóa" (khách phân loại lại sau).
 */
export function buildProductRows(intake: Row[], legacy: { products: LegacyProduct[]; processing: LegacyProcessing[] }): ProductSheetResult {
  const gcByProduct = new Map<string, LegacyProcessing[]>();
  for (const g of legacy.processing) gcByProduct.set(g.productLegacyId, [...(gcByProduct.get(g.productLegacyId) ?? []), g]);
  const gcNote = (id: string) => { const list = gcByProduct.get(id); return list?.length ? `Kiểu gia công PM cũ: ${list.map((g) => `${g.name} (×${fmtVi(g.ratio)} ${g.unit})`).join("; ")}.` : ""; };
  const legacyByName = new Map(legacy.products.map((p) => [normalizeSearch(p.name), p]));
  const used = new Set<string>(intake.map((r) => String(r[0] ?? "").trim().toUpperCase()).filter(Boolean));
  const rows: Row[] = []; let overlap = 0; const taken = new Set<string>(); const codeByLegacyId = new Map<string, string>();
  for (const r of intake) {
    const hit = legacyByName.get(normalizeSearch(String(r[1] ?? "")));
    const note = hit ? [String(r[9] ?? ""), priceNote(hit), gcNote(hit.legacyId)].filter(Boolean).join(" ") : String(r[9] ?? "");
    if (hit) { overlap++; taken.add(hit.legacyId); codeByLegacyId.set(hit.legacyId, String(r[0] ?? "").trim().toUpperCase()); }
    rows.push([r[0] ?? null, r[1] ?? null, r[2] ?? null, r[3] ?? null, r[4] ?? null, r[5] ?? null, r[6] ?? null, r[7] ?? null, r[8] ?? null, note || null]);
  }
  const codeChanges: { legacy: string; code: string }[] = []; let zeroPrice = 0;
  for (const p of legacy.products) {
    if (taken.has(p.legacyId)) continue;
    const code = sanitizeCode(p.code, used); codeByLegacyId.set(p.legacyId, code); if (code !== p.code.toUpperCase()) codeChanges.push({ legacy: p.code, code });
    if (!p.buyPrice && !p.sellPrice) zeroPrice++;
    rows.push([code, p.name, "Hàng hóa", p.unit, 0, null, null, "Không", p.active ? "Không" : "Có", [priceNote(p), gcNote(p.legacyId)].filter(Boolean).join(" ") || null]);
  }
  return { rows, fromLegacy: legacy.products.length - overlap, fromIntake: intake.length, overlapByName: overlap, codeChanges, zeroPrice, codeByLegacyId };
}

/** Tập kiểu gia công: ưu tiên bảng khách điền; tên chỉ có ở phần mềm cũ thì lấy bộ tỷ lệ phổ biến nhất. */
export function buildProcessingRows(intake: Row[], legacy: LegacyProcessing[]): Row[] {
  const out: Row[] = intake.map((r) => [r[0] ?? null, null, r[1] ?? null, r[2] ?? null, r[3] ?? null]);
  const have = new Set(intake.map((r) => normalizeSearch(String(r[0] ?? ""))));
  const groups = new Map<string, Map<string, number>>();
  for (const g of legacy) { const key = normalizeSearch(g.name); if (!key || have.has(key)) continue; const m = groups.get(key) ?? new Map(); const sig = JSON.stringify([g.name, fmtVi(g.ratio), fmtVi(g.stockRatio), g.unit]); m.set(sig, (m.get(sig) ?? 0) + 1); groups.set(key, m); }
  for (const m of groups.values()) { const [name, ratio, stock, unit] = JSON.parse([...m.entries()].sort((a, b) => b[1] - a[1])[0]![0]) as string[]; out.push([name!, null, ratio!, stock!, unit!]); }
  return out;
}
export const PROCESSING_HEADERS = ["Tên kiểu gia công", "Ghi chú", "Tỷ lệ", "Tỷ lệ trừ kho", "ĐVT"] as const;

const cellValue = (v: ExcelJS.CellValue): string | number | null => {
  if (v == null) return null; if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") { if ("richText" in v) return v.richText.map((t) => t.text).join(""); if ("result" in v) return (v.result as string | number | null) ?? null; if ("text" in v) return String(v.text); return null; }
  return v as string | number;
};
/** Đọc các trang của bảng nhập: mỗi trang = danh sách dòng (bỏ dòng trống hoàn toàn; dòng `#` ví dụ do bộ nhập tự bỏ). */
export async function readIntake(path: string): Promise<Record<string, Row[]>> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path); const out: Record<string, Row[]> = {};
  for (const ws of wb.worksheets) { const rows: Row[] = []; ws.eachRow({ includeEmpty: false }, (row) => { const v = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue); if (v.some((x) => x !== null && x !== "")) rows.push(v); }); out[ws.name] = rows; }
  return out;
}

export async function toXlsx(headers: readonly string[], rows: Row[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Dữ liệu"); ws.addRow([...headers]);
  for (const r of rows) { const row = ws.addRow(r.slice(0, headers.length).map((v) => (v === undefined ? null : v))); row.eachCell((c) => { if (typeof c.value === "number") c.numFmt = "General"; }); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
/** Điện thoại bị Excel đổi thành số mất số 0 đầu: 9 chữ số không bắt đầu bằng 0 ⇒ thêm 0. */
export const fixPhone = (v: string | number | null): string => { const s = String(v ?? "").trim(); return /^[1-9]\d{8}$/.test(s) ? `0${s}` : s; };
