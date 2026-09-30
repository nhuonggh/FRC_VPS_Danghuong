import { ReviewQueue } from "@/components/cash/ReviewQueue";
import { EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, QuickTimeFilter, SearchBox } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listReviewQueue, QUEUE_FILTER_KEYS } from "@/server/cash/queries";

export const dynamic = "force-dynamic";
const BASE = "/accounting/cash-review";

export default async function CashReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("cash.review");
  const params = parseListParams(await searchParams, QUEUE_FILTER_KEYS);
  const { rows, total } = await listReviewQueue(prisma, actor, params);
  const filtered = !!(params.q || params.filters.kind || params.filters.status || params.timePreset);
  return (
    <ListPageLayout
      title="Chờ kiểm tra quỹ"
      filters={<div className="flex flex-wrap items-center gap-2">
        <SearchBox basePath={BASE} params={params} placeholder="Tìm mã phiếu, đối tác…" />
        <MultiSelectFilter label="Loại" paramKey="kind" basePath={BASE} params={params} options={[{ value: "RECEIPT", label: "Phiếu thu" }, { value: "PAYMENT", label: "Phiếu chi" }, { value: "ADJUSTMENT", label: "Điều chỉnh" }]} />
        <MultiSelectFilter label="Trạng thái" paramKey="status" basePath={BASE} params={params} options={[{ value: "PENDING_REVIEW", label: "Chờ kiểm tra" }, { value: "RETURNED", label: "Bị trả lại" }, { value: "ADJUST_REQUESTED", label: "Chờ duyệt điều chỉnh" }]} />
        <QuickTimeFilter basePath={BASE} params={params} />
      </div>}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      {total === 0 ? <EmptyState kind={filtered ? "no-result" : "empty"} title={filtered ? "Không có mục phù hợp" : "Không còn phiếu chờ kiểm tra"} /> : <ReviewQueue rows={rows} canApprove={actor.perms.has("cash.adjust.approve")} />}
    </ListPageLayout>
  );
}
