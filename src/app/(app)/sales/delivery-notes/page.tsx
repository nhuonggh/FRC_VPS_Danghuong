import Link from "next/link";
import { Badge, EmptyState, ListPageLayout, PaginationFooter, SearchBox } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listDeliveryNotes } from "@/server/delivery/queries";

export const dynamic = "force-dynamic";
const BASE = "/sales/delivery-notes";

/** Phiếu xuất/giao (mã 37). Phiếu được lập từ chi tiết đơn (tab Giao hàng). */
export default async function DeliveryNotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("order.view");
  const params = parseListParams(await searchParams);
  const { rows, total } = await listDeliveryNotes(prisma, actor, params);
  return (
    <ListPageLayout
      title="Phiếu xuất / giao"
      filters={<SearchBox basePath={BASE} params={params} placeholder="Tìm mã phiếu, mã đơn, khách hàng…" />}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      {total === 0 ? <EmptyState kind={params.q ? "no-result" : "empty"} title="Chưa có phiếu giao nào" description="Lập phiếu giao từ trang chi tiết của đơn hàng." /> : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
              <th className="px-3 py-2">Mã phiếu</th><th className="px-3 py-2">Ngày giao</th><th className="px-3 py-2">Đơn</th><th className="px-3 py-2">Khách hàng</th><th className="px-3 py-2 text-right">Số dòng</th><th className="px-3 py-2">Trạng thái</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td><td className="px-3 py-2">{formatDateTime(r.at)}</td>
                  <td className="px-3 py-2 font-mono text-xs"><Link href={`/sales/orders/${r.orderId}?tab=delivery`} className="text-accent hover:underline">{r.orderCode}</Link></td>
                  <td className="px-3 py-2">{r.partnerName}</td><td className="px-3 py-2 text-right">{r.lineCount}</td>
                  <td className="px-3 py-2">{r.isCancelled ? <Badge tone="danger">Đã hủy</Badge> : <Badge tone="success">Hiệu lực</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPageLayout>
  );
}
