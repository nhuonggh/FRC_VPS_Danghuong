import Link from "next/link";
import { RestoreButton } from "@/components/sales/RestoreButton";
import { EmptyState, ListPageLayout, PaginationFooter, SearchBox } from "@/components/ui";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listDeletedOrders } from "@/server/sales/queries";

export const dynamic = "force-dynamic";
const BASE = "/sales/orders-deleted";

export default async function DeletedOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("order.restore");
  const params = parseListParams(await searchParams);
  const { rows, total } = await listDeletedOrders(prisma, actor, params);
  const canView = actor.perms.has("order.view");
  return (
    <ListPageLayout
      title="Đơn đã xóa"
      filters={<SearchBox basePath={BASE} params={params} placeholder="Tìm mã đơn, khách hàng…" />}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      {total === 0 ? <EmptyState kind={params.q ? "no-result" : "empty"} title="Không có đơn đã hủy" /> : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
              <th className="px-3 py-2">Mã đơn</th><th className="px-3 py-2">Ngày đơn</th><th className="px-3 py-2">Khách hàng</th>
              {rows.some((r) => r.orderTotal !== undefined) && <th className="px-3 py-2 text-right">Giá trị</th>}
              <th className="px-3 py-2">Hủy lúc</th><th className="px-3 py-2">Lý do</th><th aria-label="Thao tác" />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-mono text-xs">{canView ? <Link href={`/sales/orders/${r.id}`} className="text-accent hover:underline">{r.code}</Link> : r.code}</td>
                  <td className="px-3 py-2">{formatDate(r.orderDate)}</td><td className="px-3 py-2">{r.partnerName}</td>
                  {r.orderTotal !== undefined && <td className="px-3 py-2 text-right tabular">{formatCurrency(r.orderTotal)}</td>}
                  <td className="px-3 py-2">{formatDateTime(r.cancelledAt)}<span className="block text-xs text-fg-muted">{r.cancelledByName}</span></td>
                  <td className="px-3 py-2">{r.cancelReason}</td>
                  <td className="px-3 py-2 text-right"><RestoreButton orderId={r.id} code={r.code} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPageLayout>
  );
}
