import { PassThrough } from "node:stream";
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

/** Cấu hình cột dùng chung cho bản in-memory và bản ghi theo lô (cùng kiểu ô, cùng định dạng). */
const columnDefs = (columns: XlsxColumn[]) =>
  columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16, style: c.text ? { numFmt: "@" } : c.numFmt ? { numFmt: c.numFmt } : {} }));

const rowValues = (columns: XlsxColumn[], r: Record<string, unknown>) =>
  Object.fromEntries(columns.map((c) => [c.key, toCell(r[c.key], !!c.text)]));

export async function buildXlsx(
  sheetName: string,
  columns: XlsxColumn[],
  rows: Record<string, unknown>[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(safeSheetName(sheetName));
  ws.columns = columnDefs(columns);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) ws.addRow(rowValues(columns, r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Như buildXlsx nhưng nhận các LÔ dòng (AsyncIterable) và ghi bằng ExcelJS WorkbookWriter (stream): dòng đã ghi được
 * đẩy xuống zip ngay, không giữ cả workbook trong bộ nhớ; giữa các lô nhường vòng lặp sự kiện (`setImmediate`) để
 * request khác không bị bỏ đói. Mọi ô đi qua CÙNG `toCell` (Decimal → số, cột `text` là chữ "@", tiền tố dấu nháy chống công
 * thức tiêm nhiễm). `note` (đọc SAU khi hết lô) → thêm 1 dòng ghi chú GỘP ô trên mọi cột ở cuối.
 */
export async function buildXlsxBatched(
  sheetName: string,
  columns: XlsxColumn[],
  batches: AsyncIterable<Record<string, unknown>[]>,
  opts: { note?: () => string | null } = {},
): Promise<Buffer> {
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on("data", (c: Buffer) => chunks.push(c));
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink, useStyles: true, useSharedStrings: false });
  const ws = wb.addWorksheet(safeSheetName(sheetName), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columnDefs(columns);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).commit();
  try {
    for await (const batch of batches) {
      for (const r of batch) ws.addRow(rowValues(columns, r)).commit();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const note = opts.note?.() ?? null;
    if (note !== null) {
      const row = ws.addRow({ [columns[0]!.key]: toCell(note, false) });
      ws.mergeCells(Number(row.number), 1, Number(row.number), columns.length);
      row.commit();
    }
    ws.commit();
    await wb.commit();
  } catch (e) {
    sink.destroy();
    throw e;
  }
  return Buffer.concat(chunks);
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
