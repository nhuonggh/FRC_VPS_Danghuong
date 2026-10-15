import Link from "next/link";
import { EmptyState, ListPageLayout, PaginationFooter, SearchBox } from "@/components/ui";
import { formatDate, formatQty } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listPendingLines } from "@/server/sales/queries";

export const dynamic = "force-dynamic";
const BASE = "/inventory/pending-orders";

/** Đơn chưa đủ tồn (mã 29): dòng bán âm kho đang chờ nhập bù, cũ nhất trước. Chỉ số lượng, không giá. */
export default async function PendingOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("stock.view");
  const params = parseListParams(await searchParams);
  const { rows, total } = await listPendingLines(prisma, actor, params);
  const canOpen = actor.perms.has("order.view");
  return (
    <ListPageLayout
      title="Đơn chưa đủ tồn"
      filters={<SearchBox basePath={BASE} params={params} placeholder="Tìm mã đơn, khách hàng…" />}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      {total === 0 ? <EmptyState kind={params.q ? "no-result" : "empty"} title="Không có đơn nào đang chờ hàng" /> : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
              <th className="px-3 py-2">Đơn</th><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Khách hàng</th><th className="px-3 py-2">Sản phẩm</th><th className="px-3 py-2 text-right">SL</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.lineId} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{canOpen ? <Link href={`/sales/orders/${r.orderId}`} className="text-accent hover:underline">{r.orderCode}</Link> : r.orderCode}</td>
                  <td className="px-3 py-2">{formatDate(r.orderDate)}</td><td className="px-3 py-2">{r.partnerName}</td>
                  <td className="px-3 py-2"><strong>{r.productName}</strong><span className="block font-mono text-xs text-fg-muted">{r.productCode}</span></td>
                  <td className="px-3 py-2 text-right tabular">{formatQty(r.qty)} {r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPageLayout>
  );
}
