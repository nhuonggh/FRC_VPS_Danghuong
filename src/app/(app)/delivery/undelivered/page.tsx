import { EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, SearchBox } from "@/components/ui";
import { UndeliveredList } from "@/components/trips/UndeliveredList";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listUndelivered, UNDELIVERED_FILTER_KEYS } from "@/server/trips/queries";

export const dynamic = "force-dynamic";
const BASE = "/delivery/undelivered";

export default async function UndeliveredPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("trip.manage");
  const params = parseListParams(await searchParams, UNDELIVERED_FILTER_KEYS);
  const { rows, total } = await listUndelivered(prisma, actor, params);
  const filtered = !!(params.q || params.filters.result || params.filters.state);
  return (
    <ListPageLayout
      title="Hàng không giao được"
      filters={<div className="flex flex-wrap items-center gap-2">
        <SearchBox basePath={BASE} params={params} placeholder="Tìm mã đơn, khách…" />
        <MultiSelectFilter label="Kết quả" paramKey="result" basePath={BASE} params={params} options={[{ value: "KHONG_GIAO", label: "Không giao được" }, { value: "GIAO_MOT_PHAN", label: "Giao một phần" }]} />
        <MultiSelectFilter label="Xử lý" paramKey="state" basePath={BASE} params={params} options={[{ value: "handled", label: "Đã xử lý" }]} />
      </div>}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      {total === 0 ? <EmptyState kind={filtered ? "no-result" : "empty"} title={filtered ? "Không có mục phù hợp" : "Không có hàng nào chờ xử lý"} /> : <UndeliveredList rows={rows} canManage={actor.perms.has("trip.manage")} />}
    </ListPageLayout>
  );
}
