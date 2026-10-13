import Link from "next/link";
import { DepositActions } from "@/components/sales/DepositActions";
import { Badge, EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, SearchBox } from "@/components/ui";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { DEPOSIT_FILTER_KEYS, listDeposits } from "@/server/deposits/queries";

export const dynamic = "force-dynamic";
const BASE = "/sales/deposits";

export default async function DepositsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("deposit.manage");
  const params = parseListParams(await searchParams, DEPOSIT_FILTER_KEYS);
  const { rows, total } = await listDeposits(prisma, actor, params);
  const canOpen = actor.perms.has("order.view");
  return (
    <ListPageLayout
      title="Tiền cọc"
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox basePath={BASE} params={params} placeholder="Tìm mã phiếu, mã đơn, khách hàng…" />
          <MultiSelectFilter label="Trạng thái" paramKey="state" basePath={BASE} params={params}
            options={[{ value: "attached", label: "Đang gắn đơn" }, { value: "released", label: "Đã thành số dư khách" }, { value: "cancelled", label: "Đã hủy" }]} />
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      {total === 0 ? <EmptyState kind={params.q || params.filters.state ? "no-result" : "empty"} title="Chưa có phiếu cọc" description="Thu cọc từ trang chi tiết của đơn hàng (tab Tiền cọc)." /> : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
              <th className="px-3 py-2">Mã phiếu</th><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Khách hàng</th><th className="px-3 py-2">Đơn</th>
              <th className="px-3 py-2 text-right">Số tiền</th><th className="px-3 py-2">Quỹ</th><th className="px-3 py-2">Trạng thái</th><th aria-label="Thao tác" />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-t border-border ${r.isCancelled ? "opacity-60" : ""}`}>
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td><td className="px-3 py-2">{formatDateTime(r.at)}</td><td className="px-3 py-2">{r.partnerName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.orderCode ? (canOpen ? <Link href={`/sales/orders/${r.orderId}?tab=deposit`} className="text-accent hover:underline">{r.orderCode}</Link> : r.orderCode) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular">{formatCurrency(r.amount)}</td><td className="px-3 py-2">{r.cashAccountName}</td>
                  <td className="px-3 py-2">{r.isCancelled ? <Badge tone="danger">Đã hủy</Badge> : r.orderId === null ? <Badge tone="info">Số dư khách</Badge> : <Badge tone="success">Gắn đơn</Badge>}</td>
                  <td className="px-3 py-2 text-right">{!r.isCancelled && <DepositActions id={r.id} code={r.code} attached={r.orderId !== null} reviewed={r.reviewed} cashAccountName={r.cashAccountName} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPageLayout>
  );
}
