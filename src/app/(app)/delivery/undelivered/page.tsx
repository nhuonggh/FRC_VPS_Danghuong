import { OperationalStats } from "@/components/ui/OperationalStats";
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
  const { rows, total, stats } = await listUndelivered(prisma, actor, params);
  const filtered = !!(params.q || params.filters.result || params.filters.state);
  return (
    <ListPageLayout
      title="Hàng không giao được"
      statsClassName="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4" stats={<OperationalStats kind="undelivered" data={stats} />}
      notes={<div><p><strong>Trả kho:</strong> phải lập và lưu phiếu trả kho; phần đã trả kho không được xếp giao lại. Trả một phần thì phần còn lại vẫn có thể xếp chuyến.</p><p className="mt-1"><strong>Ghi nhận hướng xử lý:</strong> chỉ lưu ghi chú, không nhập kho, hủy đơn hay xếp chuyến. Số lượng bên dưới là số hiện tại của đơn; kết quả giao là lịch sử của từng chuyến.</p><p className="mt-1">Thao tác trên từng dòng: xe tải = xếp chuyến giao lại; kho = lập phiếu trả kho; bảng kiểm = ghi nhận hướng xử lý.</p></div>}
      filters={<div className="space-y-3"><div className="flex flex-wrap items-center gap-2">
        <SearchBox basePath={BASE} params={params} placeholder="Tìm mã đơn, khách…" />
        <MultiSelectFilter label="Kết quả" paramKey="result" basePath={BASE} params={params} options={[{ value: "KHONG_GIAO", label: "Không giao được" }, { value: "GIAO_MOT_PHAN", label: "Giao một phần" }]} />
        <MultiSelectFilter label="Tình trạng xử lý" paramKey="state" basePath={BASE} params={params} options={[{ value: "pending", label: "Cần xử lý" }, { value: "handled", label: "Đã ghi nhận" }, { value: "completed", label: "Đã giao/trả kho hết" }]} />
        <span className="text-xs text-fg-secondary">{params.filters.state?.length ? "Đang xem các trạng thái đã chọn" : "Mặc định: Cần xử lý"}</span>
      </div></div>}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      {total === 0 ? <EmptyState kind={filtered ? "no-result" : "empty"} title={filtered ? "Không có mục phù hợp" : "Không có hàng nào chờ xử lý"} /> : <UndeliveredList rows={rows} canManage={actor.perms.has("trip.manage")} canReturn={actor.perms.has("return.manage")} />}
    </ListPageLayout>
  );
}
