import ExcelJS from "exceljs";
import { formatDate } from "@/lib/format";

export interface XlsxColumn {
  header: string;
  key: string;
  width?: number;
  /** Định dạng số của Excel, vd '#,##0 "₫"'. */
  numFmt?: string;
  /**
   * Cột MÃ (vd "00123", mã vạch 19 số, SĐT "0912…"): luôn lưu là CHỮ (định dạng "@"), không bao giờ đổi thành số
   * → giữ số 0 đầu và từng chữ số của chuỗi dài. Cột không đánh dấu `text` được coi là cột số/chữ tự nhiên.
   */
  text?: boolean;
}

// Chuỗi bắt đầu bằng ký tự này bị Excel/LibreOffice hiểu là công thức khi mở/sửa lại → tiền tố dấu nháy (formula injection)
const FORMULA_START = /^[=+\-@\t\r]/;
// Chuỗi CHỈ gồm số (kể cả "-5", "+84912345678") không thể là công thức → không cần tiền tố
const PURE_NUMBER = /^[+-]?\d+(\.\d+)?$/;
// Số thực IEEE-754 chỉ giữ chính xác 15 chữ số: dài hơn thì giữ nguyên là chuỗi, không ép sang số
const MAX_EXACT_DIGITS = 15;

function toCell(v: unknown, asText: boolean): ExcelJS.CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return formatDate(v);
  if (typeof v === "number") return Number.isFinite(v) ? (asText ? String(v) : v) : null;
  if (typeof v === "boolean") return asText ? String(v) : v;
  const s = String(v); // gồm Prisma.Decimal
  if (!asText && /^-?\d+(\.\d+)?$/.test(s) && s.replace(/\D/g, "").length <= MAX_EXACT_DIGITS) return Number(s); // Decimal → SỐ
  return FORMULA_START.test(s) && !PURE_NUMBER.test(s) ? `'${s}` : s;
}

/** Tên sheet Excel: ≤ 31 ký tự, không chứa \ / * ? : [ ], không bắt đầu/kết thúc bằng dấu nháy, không rỗng. */
function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31).replace(/^'+|'+$/g, "").trim();
  return cleaned || "Sheet1";
}

export async function buildXlsx(
  sheetName: string,
  columns: XlsxColumn[],
  rows: Record<string, unknown>[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(safeSheetName(sheetName));
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 16,
    style: c.text ? { numFmt: "@" } : c.numFmt ? { numFmt: c.numFmt } : {},
  }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c) => [c.key, toCell(r[c.key], !!c.text)])));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function xlsxResponse(filename: string, buffer: Buffer): Response {
  // encodeURIComponent chừa lại ' ( ) * — không hợp lệ trong giá trị RFC 5987 → mã hoá nốt
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''${encoded}`,
      "cache-control": "no-store", // dữ liệu theo quyền + bộ lọc: proxy/trình duyệt không được lưu
    },
  });
}
