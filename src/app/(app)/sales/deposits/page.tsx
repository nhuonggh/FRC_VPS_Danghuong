import Link from "next/link";
import { DepositListControls } from "@/components/sales/DepositListControls";
import { DepositTable } from "@/components/sales/DepositTable";
import { EmptyState, ListPageLayout, PaginationFooter } from "@/components/ui";
import { DEPOSIT_STATES } from "@/lib/deposit-list";
import { formatCurrency, formatNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { DEPOSIT_FILTER_KEYS, listDeposits } from "@/server/deposits/queries";

export const dynamic = "force-dynamic";
const BASE = "/sales/deposits";
const COLORS = {
  accent: { border: "border-t-accent", active: "border-accent bg-accent-soft", text: "text-accent" },
  success: { border: "border-t-success", active: "border-success bg-success-soft", text: "text-success" },
  info: { border: "border-t-info", active: "border-info bg-info-soft", text: "text-info" },
  danger: { border: "border-t-danger", active: "border-danger bg-danger-soft", text: "text-danger" },
};
export default async function DepositsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("deposit.manage");
  const params = parseListParams(await searchParams, DEPOSIT_FILTER_KEYS);
  const now = new Date();
  const { rows, total, customers, stats, effectiveAmount, timeCounts } = await listDeposits(prisma, actor, params, now);
  const state = params.filters.state?.length === 1 ? DEPOSIT_STATES.find((s) => s.key === params.filters.state[0])?.key ?? "all" : "all";
  const filtered = !!(params.q || params.filters.state?.length || params.filters.customer?.length || params.timePreset);
  return <ListPageLayout title="Tiền cọc" description="Theo dõi phiếu cọc, gắn đơn và chuyển thành số dư khách."
    statsClassName="grid grid-cols-2 lg:grid-cols-4"
    stats={<nav aria-label="Thống kê theo trạng thái" className="contents">{DEPOSIT_STATES.map((s) => {
      const color = COLORS[s.tone], active = state === s.key;
      return <Link key={s.key} href={buildListHref(BASE, params, { filters: { state: s.key === "all" ? [] : [s.key] } })} aria-current={active ? "page" : undefined}
        className={`min-w-0 rounded-md border border-t-4 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${active ? color.active : `border-border bg-surface hover:bg-hover ${color.border}`}`}>
        <span className={`block text-sm font-medium ${active ? color.text : "text-fg-secondary"}`}>{s.label}</span><strong className="mt-1 block text-2xl tabular-nums">{formatNumber(stats[s.key].count)}</strong>
        <span className="mt-1 block text-xs text-fg-secondary tabular-nums">{formatCurrency(stats[s.key].amount)}{s.key === "all" && " hiệu lực"}</span>
      </Link>;
    })}</nav>}
    footer={<><div className="border-t border-border bg-surface px-4 py-3 text-right text-sm text-fg-secondary">Tổng tiền hiệu lực: <strong className="font-semibold text-fg tabular-nums">{formatCurrency(effectiveAmount)}</strong></div><PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} /></>}
  >
    <DepositListControls params={params} customers={customers} counts={timeCounts} now={now} />
    {rows.length === 0 ? <EmptyState kind={filtered ? "no-result" : "empty"} title={filtered ? "Không có phiếu cọc phù hợp" : "Chưa có phiếu cọc"}
      description={filtered ? "Thử đổi khoảng ngày, khách hàng hoặc trạng thái." : "Thu cọc từ trang chi tiết của đơn hàng (tab Tiền cọc)."}
      action={filtered || params.page > 1 ? <Link href={BASE} className="text-sm font-medium text-accent">Xóa bộ lọc</Link> : undefined} /> : <DepositTable rows={rows} canOpen={actor.perms.has("order.view")} />}
  </ListPageLayout>;
}
