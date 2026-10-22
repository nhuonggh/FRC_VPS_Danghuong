import Link from "next/link";
import { EmptyState, MultiSelectFilter, PageNotes, QuickTimeFilter, SearchBox, StatCard } from "@/components/ui";
import { formatCurrency, formatDate, formatQty } from "@/lib/format";
import { buildExportHref, buildListHref, type ListParams } from "@/lib/query-params";
import { ClickableRow } from "./ClickableRow";
import { OrderProfitPanel } from "./OrderProfitPanel";
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
  const orderProfit = report.key === "order-profit";
  const debtRecon = report.key === "debt-reconciliation";
  const closeHref = buildListHref(base, params, { filters: { order: [] } });
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      {/* Đầu trang (tiêu đề, KPI, bộ lọc) cố định; chỉ bảng cuộn; ghi chú ghim đáy khung. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{report.title}</h1>
        <Link href={buildExportHref(`/api/reports/${report.key}/export`, orderProfit ? { ...params, filters: { ...params.filters, order: [] } } : params)} className="flex h-11 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover md:h-10">Xuất Excel</Link>
      </div>
      {orderProfit && <section aria-label="Thống kê lãi từng đơn" className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard label="Tổng số đơn" value={report.total} />
        <StatCard label="Doanh thu" value={report.totals?.revenue ?? "0"} money />
        <StatCard label="Giá vốn" value={report.totals?.cost ?? "0"} money />
        <StatCard label="Lãi / lỗ" value={report.totals?.profit ?? "0"} money tone={Number(report.totals?.profit) < 0 ? "danger" : "success"} />
      </section>}
      {report.summary && <section aria-label={`Thống kê ${report.title.toLocaleLowerCase("vi")}`} className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {report.summary.map((stat) => <StatCard key={stat.label} {...stat} />)}
      </section>}
      {report.key !== "debt-reconciliation" && (
        <div className="flex flex-wrap items-center gap-2">
          {showSearch && <SearchBox basePath={base} params={params} placeholder={orderProfit ? "Tìm mã đơn, khách hàng…" : "Tìm…"} />}
          {(orderProfit || report.key === "by-customer") && <MultiSelectFilter label="Khách hàng" paramKey="customer" basePath={base} params={params} searchable options={report.customers ?? []} />}
          {negFilter && <MultiSelectFilter label={report.key === "consumption-compare" ? "Định mức" : "Lãi"} paramKey="neg" basePath={base} params={params} options={[{ value: "1", label: report.key === "consumption-compare" ? "Chỉ NVL vượt định mức" : "Chỉ đơn lỗ" }]} />}
          <QuickTimeFilter basePath={base} params={params} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border border-border bg-surface">
        {report.rows.length === 0 ? <EmptyState kind="empty" title="Không có dữ liệu trong khoảng thời gian này" /> : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 z-10 bg-hover"><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">{report.columns.map((c) => <th key={c.key} className={`px-3 py-2 ${c.kind === "money" || c.kind === "qty" || c.kind === "pct" || c.kind === "int" ? "text-right" : ""}`}>{c.label}</th>)}</tr></thead>
            <tbody>
              {report.rows.map((row, i) => {
                const rowCls = `border-t border-border ${neg(row) ? "bg-danger-soft text-danger" : orderProfit && String(row.id) === params.filters.order?.[0] ? "bg-accent-soft" : "hover:bg-hover"}`;
                const cells = report.columns.map((c) => <td key={c.key} className={`px-3 py-2 ${c.kind === "money" || c.kind === "qty" || c.kind === "pct" || c.kind === "int" ? "text-right tabular" : ""}`}>{orderProfit && c.key === "code" ? <Link href={buildListHref(base, params, { filters: { order: [String(row.id)] } })} className="inline-flex min-h-11 items-center font-medium text-accent hover:underline" aria-label={`Xem lãi lỗ đơn ${row.code}`}>{row.code}</Link> : fmt(c.kind, row[c.key] ?? null)}</td>);
                return debtRecon
                  ? <ClickableRow key={i} href={`/reports/debt-reconciliation/${row.id}`} label={`Xem chi tiết: ${row.item}`} className={rowCls}>{cells}</ClickableRow>
                  : <tr key={i} className={rowCls}>{cells}</tr>;
              })}
            </tbody>
            {report.totals && (
              <tfoot className="sticky bottom-0 z-10 bg-hover"><tr className="border-t-2 border-border bg-hover font-semibold">
                {report.columns.map((c) => <td key={c.key} className={`px-3 py-2 ${c.kind === "money" || c.kind === "qty" || c.kind === "pct" || c.kind === "int" ? "text-right tabular" : ""}`}>{fmt(c.kind, report.totals![c.key] ?? null)}</td>)}
              </tr></tfoot>
            )}
          </table>
        )}
      </div>
      {orderProfit && params.filters.order?.length ? <OrderProfitPanel detail={report.orderDetail ?? null} closeHref={closeHref} /> : null}
      </div>
      {!!report.notes?.length && <PageNotes label="Ghi chú báo cáo">
        {report.notes.map((note) => <p key={note}>{note}</p>)}
      </PageNotes>}
    </div>
  );
}
