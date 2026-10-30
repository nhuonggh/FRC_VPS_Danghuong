import ExcelJS from "exceljs";
import { normalizeSearch } from "@/lib/search";
import { DomainError, ValidationError } from "@/server/http/errors";
import type { ImportColumn } from "./types";
export const MAX_IMPORT_ROWS = 5000; export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export interface SheetRow { line: number; cells: Record<string, unknown> }
const blank = (v: unknown) => v == null || (typeof v === "string" && !v.trim());
function plain(v: ExcelJS.CellValue): unknown { if (v == null || v instanceof Date || typeof v !== "object") return v; if ("richText" in v) return v.richText.map((x) => x.text).join(""); if ("result" in v) return v.result ?? null; if ("text" in v) return v.text; return null; }
const decodeHtml = (s: string) => s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** Báo cáo xuất từ phần mềm cũ là bảng HTML đổi đuôi .xls. */
const looksLikeHtml = (buffer: Buffer) => /^\s*<(table|html|!doctype)/i.test(buffer.subarray(0, 64).toString("utf8").replace(/^﻿/, ""));
/** Dòng tiêu đề là dòng đầu có đủ các cột bắt buộc (trên nó có thể có dòng tên báo cáo); số dòng = vị trí `<tr>` trong tệp. */
function readHtmlSheet(buffer: Buffer, columns: readonly ImportColumn[]): SheetRow[] {
  const table = [...buffer.toString("utf8").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => decodeHtml(c[1]!)));
  const need = columns.filter((c) => c.required);
  const names = (c: ImportColumn) => [c.header, ...(c.aliases ?? [])].map(normalizeSearch);
  const headerAt = table.findIndex((cells) => { const have = new Set(cells.map(normalizeSearch)); return need.every((c) => names(c).some((n) => have.has(n))); });
  if (headerAt < 0) throw new ValidationError(`Thiếu cột bắt buộc: ${need.map((c) => c.header).join(", ")}.`);
  const heads = table[headerAt]!.map(normalizeSearch); const colOf = new Map<string, number>();
  for (const c of columns) { const i = heads.findIndex((h) => names(c).includes(h)); if (i >= 0) colOf.set(c.key, i); }
  const out: SheetRow[] = [];
  for (let i = headerAt + 1; i < table.length; i++) {
    const cells: Record<string, unknown> = {}; let any = false;
    for (const c of columns) { const v = colOf.has(c.key) ? table[i]![colOf.get(c.key)!] ?? null : null; cells[c.key] = v; any ||= !blank(v); }
    if (!any) continue;
    out.push({ line: i + 1, cells });
    if (out.length > MAX_IMPORT_ROWS) throw new ValidationError(`Tối đa ${MAX_IMPORT_ROWS} dòng mỗi tệp. Hãy tách thành nhiều tệp.`);
  }
  return out;
}
export async function readSheet(buffer: Buffer, columns: readonly ImportColumn[]): Promise<SheetRow[]> { if (buffer.byteLength > MAX_IMPORT_BYTES) throw new DomainError("Tệp quá lớn (tối đa 2 MB). Hãy tách thành nhiều tệp.", 413); if (looksLikeHtml(buffer)) return readHtmlSheet(buffer, columns); const wb = new ExcelJS.Workbook(); try { await wb.xlsx.load(buffer as unknown as ArrayBuffer); } catch { throw new ValidationError("Tệp không phải Excel (.xlsx) hợp lệ."); } const ws = wb.worksheets[0]; if (!ws) throw new ValidationError("Tệp không có trang tính nào."); const headers = new Map<string, number>(); ws.getRow(1).eachCell((cell, col) => { const v = plain(cell.value); if (typeof v === "string" || typeof v === "number") headers.set(normalizeSearch(String(v)), col); }); const colOf = new Map<string, number>(); const missing: string[] = []; for (const c of columns) { const found = [c.header, ...(c.aliases ?? [])].map(normalizeSearch).map((x) => headers.get(x)).find((x) => x !== undefined); if (found !== undefined) colOf.set(c.key, found); else if (c.required) missing.push(c.header); } if (missing.length) throw new ValidationError(`Thiếu cột bắt buộc: ${missing.join(", ")}.`); const out: SheetRow[] = []; for (let line = 2; line <= ws.rowCount; line++) { const row = ws.getRow(line); const cells: Record<string, unknown> = {}; let any = false; for (const c of columns) { const v = colOf.has(c.key) ? plain(row.getCell(colOf.get(c.key)!).value) : null; cells[c.key] = v; any ||= !blank(v); } if (!any) continue; const first = columns.map((c) => cells[c.key]).find((v) => !blank(v)); if (typeof first === "string" && first.trim().startsWith("#")) continue; out.push({ line, cells }); if (out.length > MAX_IMPORT_ROWS) throw new ValidationError(`Tối đa ${MAX_IMPORT_ROWS} dòng mỗi tệp. Hãy tách thành nhiều tệp.`); } return out; }
