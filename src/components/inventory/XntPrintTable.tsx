"use client";
import { useEffect, useState } from "react";
import { formatCurrency, formatQty } from "@/lib/format";
import type { XntRow, XntTotals } from "@/server/inventory-reports/xnt";

/** Cùng khoá lưu với `DataTable id="stock-xnt"`: bản in chỉ gồm các cột khách đã tick ở bảng (cùng trình duyệt). */
const HIDDEN_KEY = "table:stock-xnt:hidden";
type Col = { key: string; label: string; num?: boolean; cell: (r: XntRow) => string; total?: (t: XntTotals) => string | undefined };

export function XntPrintTable({ rows, totals }: { rows: XntRow[]; totals: XntTotals }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  useEffect(() => { try { const raw = localStorage.getItem(HIDDEN_KEY); if (raw) setHidden(JSON.parse(raw)); } catch { /* bỏ qua */ } }, []);
  const q = (v: string, u: string) => `${formatQty(v)} ${u}`;
  const cost = totals.closingValue !== undefined;
  const all: Col[] = [
    { key: "code", label: "Mã", cell: (r) => r.code },
    { key: "name", label: "Sản phẩm", cell: (r) => r.name },
    { key: "opening", label: "Tồn đầu", num: true, cell: (r) => q(r.opening, r.baseUnit), total: (t) => formatQty(t.opening) },
    { key: "inQty", label: "Nhập", num: true, cell: (r) => q(r.inQty, r.baseUnit), total: (t) => formatQty(t.inQty) },
    { key: "outQty", label: "Xuất", num: true, cell: (r) => q(r.outQty, r.baseUnit), total: (t) => formatQty(t.outQty) },
    { key: "closing", label: "Tồn cuối", num: true, cell: (r) => q(r.closing, r.baseUnit), total: (t) => formatQty(t.closing) },
    ...(cost ? [
      { key: "openingValue", label: "GT tồn đầu", num: true, cell: (r: XntRow) => formatCurrency(r.openingValue), total: (t: XntTotals) => formatCurrency(t.openingValue) },
      { key: "inValue", label: "GT nhập", num: true, cell: (r: XntRow) => formatCurrency(r.inValue), total: (t: XntTotals) => formatCurrency(t.inValue) },
      { key: "outValue", label: "GT xuất", num: true, cell: (r: XntRow) => formatCurrency(r.outValue), total: (t: XntTotals) => formatCurrency(t.outValue) },
      { key: "closingValue", label: "GT tồn cuối", num: true, cell: (r: XntRow) => formatCurrency(r.closingValue), total: (t: XntTotals) => formatCurrency(t.closingValue) },
    ] : []),
  ];
  const cols = all.filter((c) => c.key === "code" || !hidden[c.key]); // "Mã" luôn có, như bảng
  const textCols = cols.filter((c) => !c.num).length;
  return <table className="w-full text-sm">
    <thead><tr className="border-b border-border text-left">{cols.map((c) => <th key={c.key} scope="col" className={`p-2 ${c.num ? "text-right" : ""}`}>{c.label}</th>)}</tr></thead>
    <tbody>{rows.map((r) => <tr key={r.productId} className="border-b border-border">{cols.map((c) => <td key={c.key} className={`p-2 ${c.num ? "tabular text-right" : c.key === "code" ? "font-mono text-xs" : ""}`}>{c.cell(r)}</td>)}</tr>)}</tbody>
    {rows.length > 0 && <tfoot><tr className="border-t-2 border-border font-semibold">
      <td className="p-2" colSpan={textCols}>Tổng cộng</td>
      {cols.filter((c) => c.num).map((c) => <td key={c.key} className="tabular p-2 text-right">{c.total?.(totals)}</td>)}
    </tr></tfoot>}
  </table>;
}
