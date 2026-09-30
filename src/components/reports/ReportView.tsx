import Link from "next/link";
import { EmptyState, MultiSelectFilter, QuickTimeFilter, SearchBox } from "@/components/ui";
import { formatCurrency, formatDate, formatQty } from "@/lib/format";
import { buildExportHref, type ListParams } from "@/lib/query-params";
import type { Cell, ReportResult } from "@/server/reports/types";

const fmt = (kind: string, v: Cell): string => {
  if (v === null || v === "") return "";
  switch (kind) {
    case "money": return formatCurrency(v as string);
    case "qty": return formatQty(v as string);
    case "int": return String(v);
    case "pct": return `${v}%`;
    case "date": return formatDate(v as string);
    default: return String(v);
  }
};

/** Khung báo cáo dùng chung (67–73): bộ lọc thời gian, bảng, dòng tổng, ô cảnh báo, xuất Excel. Giá trị ÂM ở cột `negativeKey` bôi đỏ. */
export function ReportView({ report, params, base, showSearch = true, negFilter = false }: { report: ReportResult & { range: { start: Date; end: Date } }; params: ListParams; base: string; showSearch?: boolean; negFilter?: boolean }) {
  const neg = (row: Record<string, Cell>) => report.negativeKey !== undefined && Number(row[report.negativeKey] ?? 0) < 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{report.title}</h1>
        <Link href={buildExportHref(`/api/reports/${report.key}/export`, params)} className="flex h-11 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover md:h-10">Xuất Excel</Link>
      </div>
      {report.key !== "debt-reconciliation" && (
        <div className="flex flex-wrap items-center gap-2">
          {showSearch && <SearchBox basePath={base} params={params} placeholder="Tìm…" />}
          {negFilter && <MultiSelectFilter label="Lãi" paramKey="neg" basePath={base} params={params} options={[{ value: "1", label: "Chỉ đơn lỗ" }]} />}
          <QuickTimeFilter basePath={base} params={params} />
        </div>
      )}
      {report.notes?.map((n) => <p key={n} className="text-sm text-fg-secondary">{n}</p>)}
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        {report.rows.length === 0 ? <EmptyState kind="empty" title="Không có dữ liệu trong khoảng thời gian này" /> : (
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">{report.columns.map((c) => <th key={c.key} className={`px-3 py-2 ${c.kind === "money" || c.kind === "qty" || c.kind === "pct" || c.kind === "int" ? "text-right" : ""}`}>{c.label}</th>)}</tr></thead>
            <tbody>
              {report.rows.map((row, i) => (
                <tr key={i} className={`border-t border-border ${neg(row) ? "bg-danger-soft text-danger" : ""}`}>
                  {report.columns.map((c) => <td key={c.key} className={`px-3 py-2 ${c.kind === "money" || c.kind === "qty" || c.kind === "pct" || c.kind === "int" ? "text-right tabular" : ""}`}>{fmt(c.kind, row[c.key] ?? null)}</td>)}
                </tr>
              ))}
            </tbody>
            {report.totals && (
              <tfoot><tr className="border-t-2 border-border bg-hover font-semibold">
                {report.columns.map((c) => <td key={c.key} className={`px-3 py-2 ${c.kind === "money" || c.kind === "qty" || c.kind === "pct" || c.kind === "int" ? "text-right tabular" : ""}`}>{fmt(c.kind, report.totals![c.key] ?? null)}</td>)}
              </tr></tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  );
}
