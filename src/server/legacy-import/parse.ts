/**
 * Đọc "Báo cáo bán hàng hằng ngày" xuất từ phần mềm cũ. Tệp thật là HTML đổi đuôi .xls: mỗi đơn là một dòng 23 ô,
 * các dòng hàng tiếp theo của cùng đơn chỉ có 10 ô cuối (ô gộp rowspan nên không lặp lại phần đầu đơn).
 */
import { normalizePhone } from "@/lib/phone";

/** Một số hạng của dòng hàng bán theo m²: `4.5*1.08` = dài 4,5 m × khổ 1,08 (m²/md) × 1 tấm. */
export interface LegacyTerm { length: number; ratio: number; pieces: number }

export interface LegacyLine {
  /** Tên hàng như trong tệp (đã bỏ hậu tố " - <kiểu gia công>" nếu có). */
  name: string;
  /** Kiểu gia công như trong tệp ("" = không có). */
  kind: string;
  unit: string;
  /** Số lượng theo đơn vị `unit` (cột "Tổng"). */
  qty: number;
  price: number;
  amount: number;
  /** Dòng bán theo m² có kích thước: mỗi số hạng thành một dòng trong hệ thống (SL theo md). */
  terms: LegacyTerm[] | null;
}

export interface LegacyOrder {
  code: string;
  /** yyyy-mm-dd */
  date: string;
  group: string;
  customer: string;
  address: string;
  phones: string[];
  lines: LegacyLine[];
  otherFee: number;
  discount: number;
  total: number;
  paid: number;
  debt: number;
  note: string;
}

export interface LegacyParseResult { orders: LegacyOrder[]; errors: string[] }

const decode = (s: string) =>
  s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const num = (s: string | undefined) => {
  const n = Number((s ?? "").replace(/,/g, "").trim() || 0);
  return Number.isFinite(n) ? n : NaN;
};

const FULL_ROW = 22; // dòng đầu đơn có 23 ô (ô ghi chú cuối có thể bị thiếu)
const LINE_CELLS = 10;

/** "29/10/2026" → "2026-10-29"; sai định dạng → null. */
export function legacyDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** "4.5*1.08 7.9*1.08" → các số hạng; không đúng mẫu → null (dòng được coi là dòng thường). */
export function parseTerms(issued: string): LegacyTerm[] | null {
  const parts = issued.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const out: LegacyTerm[] = [];
  for (const p of parts) {
    const bits = p.split("*");
    if (bits.length < 2 || bits.length > 3 || bits.some((b) => !/^\d+(?:\.\d+)?$/.test(b))) return null;
    const length = Number(bits[0]), ratio = Number(bits[1]), pieces = bits[2] === undefined ? 1 : Number(bits[2]);
    if (!(length > 0) || !(ratio > 0) || !Number.isInteger(pieces) || pieces <= 0) return null;
    out.push({ length, ratio, pieces });
  }
  return out;
}

const AREA_UNITS = new Set(["m2", "m²"]);

function toLine(c: string[], at: number): LegacyLine {
  // c[at..]: nội dung, kiểu, lượng xuất, SL, SL xuất, tổng SL, tổng, đvt, đơn giá, thành tiền
  const kind = c[at + 1] ?? "";
  let name = c[at] ?? "";
  const suffix = ` - ${kind}`;
  if (kind && name.endsWith(suffix)) name = name.slice(0, -suffix.length).trim();
  const unit = c[at + 7] ?? "";
  const terms = AREA_UNITS.has(unit.toLowerCase()) ? parseTerms(c[at + 2] ?? "") : null;
  return { name, kind, unit, qty: num(c[at + 6]), price: num(c[at + 8]), amount: num(c[at + 9]), terms };
}

export function parseLegacySales(html: string): LegacyParseResult {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => decode(c[1]!)));
  const header = rows.findIndex((r) => r[0]?.toLowerCase() === "stt" && r.includes("Đơn hàng"));
  if (header < 0) return { orders: [], errors: ["Không nhận ra đây là 'Báo cáo bán hàng hằng ngày' (thiếu dòng tiêu đề Stt / Đơn hàng)."] };

  const orders: LegacyOrder[] = [];
  const errors: string[] = [];
  let cur: LegacyOrder | null = null;
  for (const c of rows.slice(header + 1)) {
    if (c.length >= FULL_ROW && /^\d+$/.test(c[0] ?? "")) {
      const date = legacyDate(c[1] ?? "");
      if (!date) errors.push(`Đơn ${c[6] ?? c[0]}: ngày "${c[1]}" không hợp lệ.`);
      cur = {
        code: c[6] ?? "", date: date ?? "", group: c[2] ?? "", customer: c[3] ?? "", address: c[4] ?? "",
        phones: (c[5] ?? "").split(/[-–]\s+|\s+-\s+|[,;/]/).map((p) => p.trim()).filter((p) => normalizePhone(p)),
        lines: [toLine(c, 7)], otherFee: num(c[17]), discount: num(c[18]), total: num(c[19]), paid: num(c[20]), debt: num(c[21]), note: c[22] ?? "",
      };
      if (!cur.code) errors.push(`Stt ${c[0]}: thiếu mã đơn hàng.`);
      orders.push(cur);
    } else if (cur && c.length === LINE_CELLS && c[0] && !/^(Tổng|Người)/.test(c[0])) {
      cur.lines.push(toLine(c, 0));
    } else if (/^Tổng$/.test(c[0] ?? "")) {
      cur = null;
    }
  }
  for (const o of orders) {
    if (o.lines.some((l) => !Number.isFinite(l.qty) || !Number.isFinite(l.price) || !(l.qty > 0))) errors.push(`Đơn ${o.code}: có dòng hàng sai số lượng/đơn giá.`);
  }
  return { orders, errors };
}
