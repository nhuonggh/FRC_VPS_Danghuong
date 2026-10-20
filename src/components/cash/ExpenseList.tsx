import { Plus } from "lucide-react";
import Link from "next/link";
import { Badge, EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, QuickTimeFilter, SearchBox } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { REVIEW_LABEL, type ExpenseRowDTO, type ExpenseSummaryDTO } from "@/server/cash/queries";

const TONE = { PENDING_REVIEW: "warning", REVIEWED: "success", RETURNED: "danger", CANCELLED: "neutral" } as const;
const BASE = "/accounting/expenses";

/** Chi phí hoạt động (66): danh sách + tổng theo loại và theo tháng của tập đang lọc (không tính khoản đã hủy). */
export function ExpenseList({ rows, total, summary, params, types, canCreate, exportHref }: { rows: ExpenseRowDTO[]; total: number; summary: ExpenseSummaryDTO; params: ListParams; types: { id: number; name: string }[]; canCreate: boolean; exportHref: string }) {
  const filtered = !!(params.q || params.filters.status || params.filters.type || params.timePreset);
  return (
    <ListPageLayout
      title="Chi phí hoạt động"
      actions={<>
        <a href={exportHref} className="flex h-11 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover md:h-10">Xuất Excel</a>
        {canCreate && <Link href={`${BASE}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden />Lập chi phí</Link>}
      </>}
      stats={<div className="grid w-full gap-3 lg:grid-cols-3">
        <div className="rounded-md border border-border bg-surface p-3"><span className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">Tổng chi phí (đang lọc)</span><span className="tabular block text-2xl font-bold">{formatCurrency(summary.total)}</span><span className="text-xs text-fg-muted">{summary.count} khoản</span></div>
        <div className="rounded-md border border-border bg-surface p-3"><span className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">Theo loại</span><ul className="mt-1 space-y-0.5 text-sm">{summary.byType.slice(0, 5).map((t) => <li key={t.expenseTypeId} className="flex justify-between gap-2"><span>{t.name}</span><span className="tabular">{formatCurrency(t.amount)}</span></li>)}{summary.byType.length === 0 && <li className="text-fg-muted">—</li>}</ul></div>
        <div className="rounded-md border border-border bg-surface p-3"><span className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">Theo tháng</span><ul className="mt-1 space-y-0.5 text-sm">{summary.byMonth.slice(0, 5).map((m) => <li key={m.month} className="flex justify-between gap-2"><span>{m.month.slice(5)}/{m.month.slice(0, 4)}</span><span className="tabular">{formatCurrency(m.amount)}</span></li>)}{summary.byMonth.length === 0 && <li className="text-fg-muted">—</li>}</ul></div>
      </div>}
      filters={<div className="flex flex-wrap items-center gap-2">
        <SearchBox basePath={BASE} params={params} placeholder="Tìm mã phiếu, ghi chú…" />
        <MultiSelectFilter label="Loại chi phí" paramKey="type" basePath={BASE} params={params} options={types.map((t) => ({ value: String(t.id), label: t.name }))} />
        <MultiSelectFilter label="Trạng thái" paramKey="status" basePath={BASE} params={params} options={[{ value: "PENDING_REVIEW", label: "Chờ kiểm tra" }, { value: "RETURNED", label: "Bị trả lại" }, { value: "REVIEWED", label: "Đã kiểm tra" }, { value: "CANCELLED", label: "Đã hủy" }]} />
        <QuickTimeFilter basePath={BASE} params={params} />
      </div>}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      {total === 0 ? <EmptyState kind={filtered ? "no-result" : "empty"} title={filtered ? "Không có khoản chi phí phù hợp" : "Chưa có chi phí"} action={filtered ? <Link href={BASE} className="text-sm font-medium text-accent">Xóa bộ lọc</Link> : undefined} /> : (
        <table className="w-full min-w-[880px] text-sm">
          <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Phiếu chi</th><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Loại</th><th className="px-3 py-2 text-right">Số tiền</th><th className="px-3 py-2">Quỹ</th><th className="px-3 py-2">Người ứng tiền</th><th className="px-3 py-2">Ghi chú</th><th className="px-3 py-2">Trạng thái</th></tr></thead>
          <tbody>
            {rows.map((r) => { const state = r.isCancelled ? "CANCELLED" : r.reviewStatus; return (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs"><Link href={`/accounting/payments/${r.paymentId}`} className="text-accent hover:underline">{r.code}</Link></td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.at)}</td><td className="px-3 py-2">{r.expenseTypeName}</td>
                <td className={`px-3 py-2 text-right tabular ${r.isCancelled ? "text-fg-muted line-through" : ""}`}>{formatCurrency(r.amount)}</td>
                <td className="px-3 py-2">{r.cashAccountName}</td><td className="px-3 py-2">{r.advancedByName ?? "—"}</td><td className="px-3 py-2">{r.note}</td>
                <td className="px-3 py-2"><Badge tone={TONE[state]}>{REVIEW_LABEL[state]}</Badge></td>
              </tr>
            ); })}
          </tbody>
        </table>
      )}
    </ListPageLayout>
  );
}
