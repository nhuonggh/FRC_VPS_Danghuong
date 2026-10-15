import Link from "next/link";
import { Badge, EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, SearchBox, StatCard } from "@/components/ui";
import { formatCurrency } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { DiscountRowDTO, DiscountSummaryDTO } from "@/server/discount/queries";

const BASE = "/accounting/discounts";

/** Sổ chiết khấu tích lũy theo khách: số dư còn nợ khách, cảnh báo số dư âm, phiếu tất toán chờ hậu kiểm. */
export function DiscountList({ rows, total, summary, params }: { rows: DiscountRowDTO[]; total: number; summary: DiscountSummaryDTO; params: ListParams }) {
  const state = params.filters.state?.[0];
  const filtered = !!(params.q || params.filters.state);
  return (
    <ListPageLayout
      title="Chiết khấu tích lũy"
      stats={<>
        <div className="flex min-w-32 flex-1 flex-col gap-1 rounded-md border border-border bg-surface p-3"><span className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">Tổng còn nợ khách</span><span className="tabular text-2xl font-bold text-success">{formatCurrency(summary.balance)}</span></div>
        <StatCard label="Số dư âm (cần xử lý)" value={summary.negative} tone={summary.negative > 0 ? "danger" : "neutral"} href={buildListHref(BASE, params, { filters: { state: ["negative"] } })} active={state === "negative"} />
      </>}
      filters={<div className="flex flex-wrap items-center gap-2"><SearchBox basePath={BASE} params={params} placeholder="Tìm mã, tên khách…" /><MultiSelectFilter label="Số dư" paramKey="state" basePath={BASE} params={params} options={[{ value: "positive", label: "Còn nợ khách" }, { value: "negative", label: "Số dư âm" }]} /></div>}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      {total === 0 ? <EmptyState kind={filtered ? "no-result" : "empty"} title={filtered ? "Không có khách phù hợp" : "Chưa có chiết khấu tích lũy"} /> : (
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Mã</th><th className="px-3 py-2">Khách</th><th className="px-3 py-2 text-right">Đầu kỳ</th><th className="px-3 py-2 text-right">Phát sinh</th><th className="px-3 py-2 text-right">Đã tất toán / trừ</th><th className="px-3 py-2 text-right">Còn lại</th><th className="px-3 py-2">Ghi chú</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.partnerId} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs"><Link href={`${BASE}/${r.partnerId}`} className="text-accent hover:underline">{r.code}</Link></td>
                <td className="px-3 py-2"><strong>{r.name}</strong><span className="block text-xs text-fg-muted">{r.groupName}</span></td>
                <td className="px-3 py-2 text-right tabular">{formatCurrency(r.opening)}</td><td className="px-3 py-2 text-right tabular">{formatCurrency(r.accrued)}</td><td className="px-3 py-2 text-right tabular">{formatCurrency(r.settled)}</td>
                <td className={`px-3 py-2 text-right tabular font-semibold ${Number(r.balance) < 0 ? "text-danger" : ""}`}>{formatCurrency(r.balance)}</td>
                <td className="px-3 py-2 space-x-1">{Number(r.balance) < 0 && <Badge tone="danger">Số dư âm</Badge>}{r.unreconciled > 0 && <Badge tone="warning">{r.unreconciled} phiếu chờ hậu kiểm</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ListPageLayout>
  );
}
