import { catalogSchema, getSection, type CatalogField, type CatalogSection } from "@/config/catalog-sections";
import { normalizeSearch } from "@/lib/search";
import type { ImportColumn, ImportSpec } from "@/server/import/types";
import { parseYesNo } from "@/server/partners/import-spec";
import { delegate } from "./adapters";

/** Một dòng đã kiểm: `key` = khoá so trùng (không dấu, không phân biệt hoa/thường); `data` = đúng dạng service tạo mới nhận. */
export interface CatalogImportRow { key: string; data: Record<string, string | boolean | null> }

const str = (value: unknown) => (value == null ? "" : String(value).trim());
const SAMPLES: Record<string, string> = { "partner-groups": "Khách lẻ", "product-groups": "Tấm alu", warehouses: "Kho chính", vehicles: "51C-123.45", drivers: "Nguyễn Văn A", routes: "Quận 12", "expense-types": "Tiền điện", "cash-accounts": "Tiền mặt", "processing-types": "Tôn xốp" };
/** Cột phụ chỉ có ở Kiểu gia công: hệ thống chưa có công thức tự động nên gộp vào Ghi chú để không mất dữ liệu cũ (công thức thật nằm ở Định mức/BOM). */
const PROCESSING_EXTRAS: readonly ImportColumn[] = [{ key: "ratio", header: "Tỷ lệ", sample: "1,08" }, { key: "stockRatio", header: "Tỷ lệ trừ kho", sample: "1" }, { key: "unit", header: "ĐVT", sample: "m2" }];

const keyText = (section: CatalogSection, raw: string) => (section.key === "vehicles" ? raw.replace(/\s+/g, "").toUpperCase() : normalizeSearch(raw));
const SELECT_ALIASES: Record<string, string> = { "tien mat": "CASH", cash: "CASH", "ngan hang": "BANK", bank: "BANK" };

function columnsOf(section: CatalogSection): ImportColumn[] {
  const cols = section.fields.map((f, i): ImportColumn => ({ key: f.name, header: f.label, required: !!f.required, sample: i === 0 ? SAMPLES[section.key]! : f.type === "checkbox" ? "Không" : f.type === "select" ? "Ngân hàng" : "" }));
  return section.key === "processing-types" ? [...cols, ...PROCESSING_EXTRAS] : cols;
}

function readField(f: CatalogField, section: CatalogSection, cells: Record<string, unknown>, errors: string[]): unknown {
  const raw = str(cells[f.name]);
  if (f.type === "checkbox") { const v = parseYesNo(raw); if (v === null) errors.push(`${f.label}: "${raw}" — nhập Có hoặc Không.`); return v ?? false; }
  if (f.type === "select") {
    if (!raw) return section.key === "cash-accounts" ? (str(cells.bankNo) ? "BANK" : "CASH") : raw;
    const mapped = SELECT_ALIASES[normalizeSearch(raw)] ?? f.options?.find((o) => o.value === raw.toUpperCase())?.value;
    if (!mapped) errors.push(`${f.label}: "${raw}" không hợp lệ (Tiền mặt hoặc Ngân hàng).`);
    return mapped ?? raw;
  }
  return f.name === "plate" ? raw.replace(/\s+/g, "").toUpperCase() : raw;
}

function processingNote(note: string, cells: Record<string, unknown>): string {
  const parts = [["Tỷ lệ", cells.ratio], ["Trừ kho", cells.stockRatio], ["ĐVT", cells.unit]].map(([label, v]) => (str(v) ? `${label} ${typeof v === "number" ? String(v).replace(".", ",") : str(v)}` : "")).filter(Boolean);
  return [note, parts.join(" · ")].filter(Boolean).join(" — ");
}

/** Nhập Excel cho một mục Cài đặt danh mục: dùng lại đúng zod của form tạo mới nên luật kiểm tra giống hệt nhập tay. Ô trống ⇒ giữ nguyên dữ liệu có sẵn khi ghi đè. */
export function catalogImportSpec(sectionKey: string): ImportSpec<CatalogImportRow> {
  const section = getSection(sectionKey);
  if (!section) throw new Error(`Mục danh mục không tồn tại: ${sectionKey}`);
  const schema = catalogSchema(section);
  const existingRows = async (db: Parameters<ImportSpec<CatalogImportRow>["existingKeys"]>[0]) => new Map((await delegate(db, section.key).findMany({ select: { id: true, [section.titleField]: true } })).map((r) => [keyText(section, String(r[section.titleField])), r.id]));
  return {
    entity: section.entity, label: section.singular, columns: columnsOf(section),
    async loadContext() { return undefined; },
    parseRow(cells) {
      const errors: string[] = []; const raw: Record<string, unknown> = {};
      for (const f of section.fields) raw[f.name] = readField(f, section, cells, errors);
      if (section.key === "processing-types") raw.note = processingNote(str(raw.note), cells);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) errors.push(...parsed.error.issues.map((i) => i.message));
      if (errors.length || !parsed.success) return { ok: false, errors };
      const data = Object.fromEntries(section.fields.map((f) => [f.name, f.type === "text" && !f.required && parsed.data[f.name] === "" ? null : parsed.data[f.name]])) as CatalogImportRow["data"];
      return { ok: true, data: { key: keyText(section, String(data[section.titleField])), data } };
    },
    keyOf: (row) => row.key,
    async existingKeys(db, keys) { const have = await existingRows(db); return new Set(keys.filter((k) => have.has(k))); },
    async create(tx, _actor, rows) { for (const row of rows) await delegate(tx, section.key).create({ data: row.data }); },
    async update(tx, _actor, rows) {
      const have = await existingRows(tx);
      for (const row of rows) {
        // Không đổi loại quỹ qua import (service sửa tay chặn khi tài khoản đã có giao dịch/số đầu kỳ).
        const data = { ...row.data }; if (section.key === "cash-accounts") delete data.type;
        // Ô trống không xoá dữ liệu cũ.
        const patch = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null));
        await delegate(tx, section.key).update({ where: { id: have.get(row.key)! }, data: patch });
      }
    },
  };
}
