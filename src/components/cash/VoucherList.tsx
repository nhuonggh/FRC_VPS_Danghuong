import { Plus } from "lucide-react";
import Link from "next/link";
import { Badge, EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, QuickTimeFilter, SearchBox, StatCard } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { PAYMENT_KIND_LABEL, RECEIPT_TYPE_LABEL, type VoucherDoc } from "@/server/cash/schemas";
import { REVIEW_LABEL, type VoucherRowDTO, type VoucherStatsDTO } from "@/server/cash/queries";

const TONE = { PENDING_REVIEW: "warning", REVIEWED: "success", RETURNED: "danger", CANCELLED: "neutral" } as const;
const STATUS_OPTIONS = [{ value: "PENDING_REVIEW", label: "Chờ kiểm tra" }, { value: "RETURNED", label: "Bị trả lại" }, { value: "REVIEWED", label: "Đã kiểm tra" }, { value: "CANCELLED", label: "Đã hủy" }];

/** Danh sách phiếu thu (56) / phiếu chi (58): 3 ô đếm theo trạng thái hậu kiểm, lọc trạng thái/loại/thời gian. */
export function VoucherList({ doc, rows, total, stats, params, canCreate }: { doc: VoucherDoc; rows: VoucherRowDTO[]; total: number; stats: VoucherStatsDTO; params: ListParams; canCreate: boolean }) {
  const receipt = doc === "RECEIPT";
  const base = receipt ? "/accounting/receipts" : "/accounting/payments";
  const status = params.filters.status?.[0];
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(base, params, patch);
  const labels: Record<string, string> = receipt ? RECEIPT_TYPE_LABEL : PAYMENT_KIND_LABEL;
  const typeKeys = receipt ? ["THU_NO", "COC", "KHAC"] : ["TRA_NCC", "HOAN_KHACH", "CHI_PHI", "TAT_TOAN_CK", "KHAC"];
  const filtered = !!(params.q || params.filters.status || params.filters.type || params.timePreset);
  return (
    <ListPageLayout
      title={receipt ? "Phiếu thu" : "Phiếu chi"}
      actions={canCreate ? <Link href={`${base}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden />{receipt ? "Lập phiếu thu" : "Lập phiếu chi"}</Link> : undefined}
      stats={<>
        <StatCard label="Chờ kiểm tra" value={stats.pending} tone="warning" href={href({ filters: { status: ["PENDING_REVIEW"] } })} active={status === "PENDING_REVIEW"} />
        <StatCard label="Bị trả lại" value={stats.returned} tone="danger" href={href({ filters: { status: ["RETURNED"] } })} active={status === "RETURNED"} />
        <StatCard label="Đã kiểm tra" value={stats.reviewed} tone="success" href={href({ filters: { status: ["REVIEWED"] } })} active={status === "REVIEWED"} />
      </>}
      filters={<div className="flex flex-wrap items-center gap-2">
        <SearchBox basePath={base} params={params} placeholder="Tìm mã phiếu, đối tác…" />
        <MultiSelectFilter label="Trạng thái" paramKey="status" basePath={base} params={params} options={STATUS_OPTIONS} />
        <MultiSelectFilter label="Loại" paramKey="type" basePath={base} params={params} options={typeKeys.map((k) => ({ value: k, label: labels[k]! }))} />
        <QuickTimeFilter basePath={base} params={params} />
        {(params.filters.cashType || params.filters.account) && <span className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary">{params.filters.cashType?.[0] === "BANK" ? "Phiếu qua ngân hàng" : "Đang lọc tài khoản"}{params.filters.account && rows[0] ? ` · ${rows[0].cashAccountName}` : ""}<Link href={href({ filters: { account: [], cashType: [] } })} className="inline-flex min-h-11 items-center font-medium text-accent">Xóa lọc tài khoản</Link></span>}
        {Number(stats.pendingAmount) > 0 && <span className="text-sm text-fg-secondary">Chưa kiểm tra: <strong className="tabular">{formatCurrency(stats.pendingAmount)}</strong></span>}
      </div>}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => href(page)} />}
    >
      {total === 0 ? <EmptyState kind={filtered ? "no-result" : "empty"} title={filtered ? "Không có phiếu phù hợp" : receipt ? "Chưa có phiếu thu" : "Chưa có phiếu chi"} action={filtered ? <Link href={base} className="text-sm font-medium text-accent">Xóa bộ lọc</Link> : undefined} /> : (
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
            <th className="px-3 py-2">Mã</th><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Loại</th><th className="px-3 py-2">Đối tác</th><th className="px-3 py-2">Quỹ</th><th className="px-3 py-2 text-right">Số tiền</th><th className="px-3 py-2">Trạng thái</th><th className="px-3 py-2">Người lập</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const state = r.isCancelled ? "CANCELLED" : r.reviewStatus;
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs"><Link href={`${base}/${r.id}`} className="text-accent hover:underline">{r.code}</Link></td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.at)}</td>
                  <td className="px-3 py-2">{r.typeLabel}{r.orderCode && <span className="block text-xs text-fg-muted">{r.orderCode}</span>}</td>
                  <td className="px-3 py-2">{r.partnerName}</td>
                  <td className="px-3 py-2">{r.cashAccountName}</td>
                  <td className="px-3 py-2 text-right tabular">{formatCurrency(r.amount)}</td>
                  <td className="px-3 py-2"><Badge tone={TONE[state]}>{REVIEW_LABEL[state]}</Badge></td>
                  <td className="px-3 py-2">{r.createdByName}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </ListPageLayout>
  );
}
