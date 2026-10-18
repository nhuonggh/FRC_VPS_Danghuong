import { ReviewQueue } from "@/components/cash/ReviewQueue";
import Link from "next/link";
import { StatCard, EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, QuickTimeFilter, SearchBox } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listReviewQueue, QUEUE_FILTER_KEYS } from "@/server/cash/queries";

export const dynamic = "force-dynamic";
const BASE = "/accounting/cash-review";

export default async function CashReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("cash.review");
  const params = parseListParams(await searchParams, QUEUE_FILTER_KEYS);
  const { rows, total, stats } = await listReviewQueue(prisma, actor, params);
  const filtered = !!(params.q || params.filters.kind || params.filters.status || params.timePreset);
  return (
    <ListPageLayout
      title="Chờ kiểm tra quỹ"
      statsClassName="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
      stats={<><StatCard label="Tổng mục chờ xử lý" value={total} /><StatCard label="Phiếu thu" value={stats.receipts} /><StatCard label="Phiếu chi" value={stats.payments} tone="warning" /><StatCard label="Yêu cầu điều chỉnh" value={stats.adjustments} tone="info" /></>}
      filters={<div className="flex flex-wrap items-center gap-2">
        <SearchBox basePath={BASE} params={params} placeholder="Tìm mã phiếu, đối tác…" />
        <MultiSelectFilter label="Loại" paramKey="kind" basePath={BASE} params={params} options={[{ value: "RECEIPT", label: "Phiếu thu" }, { value: "PAYMENT", label: "Phiếu chi" }, { value: "ADJUSTMENT", label: "Điều chỉnh" }]} />
        <MultiSelectFilter label="Trạng thái" paramKey="status" basePath={BASE} params={params} options={[{ value: "PENDING_REVIEW", label: "Chờ kiểm tra" }, { value: "RETURNED", label: "Bị trả lại" }, { value: "ADJUST_REQUESTED", label: "Chờ duyệt điều chỉnh" }]} />
        <QuickTimeFilter basePath={BASE} params={params} />
        {(params.filters.cashType || params.filters.account) && <span className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary">{params.filters.cashType?.[0] === "BANK" ? "Phiếu qua ngân hàng" : "Đang lọc tài khoản"}<Link href={buildListHref(BASE, params, { filters: { account: [], cashType: [] } })} className="inline-flex min-h-11 items-center font-medium text-accent">Xóa lọc tài khoản</Link></span>}
      </div>}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      {total === 0 ? <EmptyState kind={filtered ? "no-result" : "empty"} title={filtered ? "Không có mục phù hợp" : "Không còn phiếu chờ kiểm tra"} /> : <ReviewQueue rows={rows} canApprove={actor.perms.has("cash.adjust.approve")} />}
    </ListPageLayout>
  );
}
