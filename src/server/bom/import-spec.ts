import { parseViNumber } from "@/lib/parse-number";
import { normalizeSearch } from "@/lib/search";
import { ictYmd } from "@/lib/time";
import { ValidationError } from "@/server/http/errors";
import type { ImportColumn, ImportSpec } from "@/server/import/types";
import { BOM_MATERIAL_KINDS, BOM_MAX_LINES, BOM_TARGET_KINDS } from "./schemas";
import { createBomVersion } from "./service";

/**
 * Nhập định mức (BOM) từ Excel: MỖI DÒNG = 1 nguyên vật liệu của 1 cặp (thành phẩm × kiểu gia công); nhiều dòng cùng cặp = 1
 * phiên bản. Cột khớp trang "Định mức (BOM)" của file bổ sung gửi khách. Nhóm lỗi thì loại CẢ nhóm (không nhập dở định mức).
 * Cặp đã có định mức: bỏ qua; bật "Ghi đè" ⇒ tạo PHIÊN BẢN MỚI (D-19: không sửa bản cũ; ngày hiệu lực không ở quá khứ).
 */
export interface BomImportRow { productCode: string; productId: number; processingTypeId: number; processingName: string; validFrom: string; materialCode: string; materialId: number; qtyPerUnit: number; note: string; empty: boolean; seq: number }
interface Ref { id: number; kind: string; isActive: boolean }
interface BomImportCtx { products: Map<string, Ref>; types: Map<string, { id: number; name: string; isActive: boolean }>; today: string; seq: number }

const columns: readonly ImportColumn[] = [
  { key: "productCode", header: "Mã thành phẩm", required: true, sample: "TX6S-01" },
  { key: "productName", header: "Tên thành phẩm", sample: "Tôn xốp 6 sóng" },
  { key: "processingType", header: "Kiểu gia công", required: true, sample: "Tôn xốp 6S" },
  { key: "validFrom", header: "Ngày hiệu lực (dd/mm/yyyy)", aliases: ["Ngày hiệu lực"], sample: "01/10/2026" },
  { key: "material", header: "Mã nguyên vật liệu", required: true, sample: "TON-04" },
  { key: "qty", header: "Định mức / 1 đơn vị thành phẩm", aliases: ["Định mức"], required: true, sample: "1,05" },
  { key: "note", header: "Ghi chú (tỷ lệ cũ, mùa, độ dày…)", aliases: ["Ghi chú"], sample: "" },
];

const SEP = " | ";
const text = (v: unknown) => (v == null ? "" : String(v).trim());
const KIND_LABEL: Record<string, string> = { HANG: "Hàng hóa", NVL: "Nguyên vật liệu", THANH_PHAM: "Thành phẩm", PHU_KIEN: "Phụ kiện" };
const kinds = (list: readonly string[]) => list.map((k) => KIND_LABEL[k]).join(", ");

/** Ngày hiệu lực: ô ngày của Excel, `dd/mm/yyyy` hoặc `yyyy-mm-dd`; ô trống = hôm nay (ICT). */
export function parseBomDate(raw: unknown, today: string): { ok: true; value: string } | { ok: false } {
  if (raw == null || (typeof raw === "string" && !raw.trim())) return { ok: true, value: today };
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? { ok: false } : { ok: true, value: ictYmd(raw) };
  if (typeof raw !== "string") return { ok: false };
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw.trim());
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  const [y, mo, d] = m ? [m[3]!, m[2]!, m[1]!] : iso ? [iso[1]!, iso[2]!, iso[3]!] : [];
  if (!y || !mo || !d) return { ok: false };
  const ymd = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const t = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === ymd ? { ok: true, value: ymd } : { ok: false };
}

const pairOf = (r: { productCode: string; processingName: string }) => `${r.productCode}${SEP}${r.processingName}`;

export const bomImportSpec = (): ImportSpec<BomImportRow, BomImportCtx> => ({
  entity: "Bom",
  label: "định mức",
  columns,
  async loadContext(db) {
    const [products, types] = await Promise.all([
      db.product.findMany({ select: { id: true, code: true, kind: true, isActive: true } }),
      db.processingType.findMany({ select: { id: true, name: true, isActive: true } }),
    ]);
    return {
      products: new Map(products.map((p) => [p.code.toUpperCase(), { id: p.id, kind: p.kind, isActive: p.isActive }])),
      types: new Map(types.map((t) => [normalizeSearch(t.name), t])),
      today: ictYmd(new Date()),
      seq: 0,
    };
  },
  group: {
    // Dòng chưa điền NVL + định mức (cặp lấy sẵn từ phần mềm cũ) không thuộc nhóm nào: bị bỏ qua, không làm hỏng nhóm.
    of: (c) => (text(c.material) || text(c.qty) ? `${text(c.productCode).toUpperCase()}${SEP}${normalizeSearch(text(c.processingType))}` : ""),
    check(rows) {
      if (rows.length > BOM_MAX_LINES) return `Một định mức tối đa ${BOM_MAX_LINES} dòng NVL.`;
      return new Set(rows.map((r) => r.validFrom)).size > 1 ? "Các dòng cùng một định mức phải cùng ngày hiệu lực." : null;
    },
  },
  parseRow(cells, ctx) {
    const code = text(cells.productCode).toUpperCase();
    const ptName = text(cells.processingType);
    const matCode = text(cells.material).toUpperCase();
    const seq = ++ctx.seq;
    if (!code) return { ok: false, errors: ["Thiếu mã thành phẩm."] };
    const product = ctx.products.get(code);
    const type = ctx.types.get(normalizeSearch(ptName));
    const errors: string[] = [];
    if (!product) errors.push(`Không có thành phẩm "${code}".`);
    else if (!(BOM_TARGET_KINDS as readonly string[]).includes(product.kind)) errors.push(`${code}: chỉ khai báo định mức cho ${kinds(BOM_TARGET_KINDS)}.`);
    else if (!product.isActive) errors.push(`${code} đã tắt.`);
    if (!ptName) errors.push("Thiếu kiểu gia công.");
    else if (!type) errors.push(`Không có kiểu gia công "${ptName}".`);
    else if (!type.isActive) errors.push(`Kiểu gia công "${type.name}" đã tắt.`);
    const date = parseBomDate(cells.validFrom, ctx.today);
    if (!date.ok) errors.push("Ngày hiệu lực không hợp lệ (dd/mm/yyyy).");
    const note = text(cells.note).slice(0, 200);
    if (!matCode && !text(cells.qty)) {
      if (errors.length) return { ok: false, errors };
      return { ok: true, data: { productCode: code, productId: product!.id, processingTypeId: type!.id, processingName: type!.name, validFrom: date.ok ? date.value : ctx.today, materialCode: "", materialId: 0, qtyPerUnit: 0, note, empty: true, seq } };
    }
    const material = ctx.products.get(matCode);
    if (!matCode) errors.push("Thiếu mã nguyên vật liệu.");
    else if (!material) errors.push(`Không có nguyên vật liệu "${matCode}".`);
    else if (matCode === code) errors.push("Nguyên vật liệu không được trùng với chính thành phẩm.");
    else if (!material.isActive) errors.push(`${matCode} đã tắt.`);
    else if (!(BOM_MATERIAL_KINDS as readonly string[]).includes(material.kind)) errors.push(`${matCode} không phải ${kinds(BOM_MATERIAL_KINDS)}.`);
    const n = parseViNumber(cells.qty, { maxFrac: 3 });
    const qty = n.ok && n.value !== null ? Number(n.value) : NaN;
    if (!n.ok) errors.push(`Định mức: ${n.message}`);
    else if (!(qty > 0) || qty > 999_999_999) errors.push("Định mức phải lớn hơn 0.");
    if (errors.length) return { ok: false, errors };
    return { ok: true, data: { productCode: code, productId: product!.id, processingTypeId: type!.id, processingName: type!.name, validFrom: date.ok ? date.value : ctx.today, materialCode: matCode, materialId: material!.id, qtyPerUnit: qty, note, empty: false, seq } };
  },
  keyOf: (r) => (r.empty ? `${pairOf(r)}${SEP}(chưa điền #${r.seq})` : `${pairOf(r)}${SEP}${r.materialCode}`),
  skipReason: (r) => (r.empty ? "Chưa điền nguyên vật liệu / định mức (bỏ qua)." : null),
  async existingKeys(db, keys) {
    const pairs = new Map<string, string[]>();
    for (const k of keys) { const parts = k.split(SEP); const pair = parts.slice(0, 2).join(SEP); pairs.set(pair, [...(pairs.get(pair) ?? []), k]); }
    const found = await db.bom.findMany({
      where: { product: { code: { in: [...pairs.keys()].map((p) => p.split(SEP)[0]!) } }, versions: { some: { status: "ACTIVE" } } },
      select: { product: { select: { code: true } }, processingType: { select: { name: true } } },
    });
    const out = new Set<string>();
    for (const b of found) for (const k of pairs.get(`${b.product.code.toUpperCase()}${SEP}${b.processingType.name}`) ?? []) out.add(k);
    return out;
  },
  async create(tx, actor, rows) { await writeVersions(tx, actor, rows, false); },
  async update(tx, actor, rows) { await writeVersions(tx, actor, rows, true); },
});

async function writeVersions(tx: Parameters<typeof createBomVersion>[0], actor: Parameters<typeof createBomVersion>[1], rows: BomImportRow[], existing: boolean) {
  const groups = new Map<string, BomImportRow[]>();
  for (const r of rows) groups.set(pairOf(r), [...(groups.get(pairOf(r)) ?? []), r]);
  const today = ictYmd(new Date());
  for (const list of groups.values()) {
    const first = list[0]!;
    if (existing && first.validFrom < today) throw new ValidationError(`${first.productCode} × ${first.processingName}: đã có định mức nên ngày hiệu lực không được trước hôm nay.`);
    await createBomVersion(tx, actor, {
      productId: first.productId,
      processingTypeId: first.processingTypeId,
      validFrom: first.validFrom,
      note: "Nhập từ Excel",
      lines: list.map((r) => ({ materialProductId: r.materialId, qtyPerUnit: r.qtyPerUnit, ...(r.note ? { note: r.note } : {}) })),
    });
  }
}
