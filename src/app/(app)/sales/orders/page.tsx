import { Plus, Printer } from "lucide-react";
import Link from "next/link";
import { OrderTable } from "@/components/sales/OrderTable";
import { EmptyState, ListPageLayout, PaginationFooter, StatCard } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { advanceExpectedDeliveryDates, listOrderCreators, listOrders, ORDER_FILTER_KEYS } from "@/server/sales/queries";
import { OrderListControls } from "@/components/sales/OrderListControls";
import { partnerScopeWhere } from "@/lib/permissions/scope";
import { activeOrderTab, resetOrderStatusFilters } from "@/components/sales/order-list-config";

export const dynamic = "force-dynamic";
const BASE = "/sales/orders";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("order.view");
  const params = parseListParams(await searchParams, ORDER_FILTER_KEYS);
  const now = new Date();
  await advanceExpectedDeliveryDates(prisma, now); // ngày giao quá hạn tự dời về hôm nay (lần đầu trong ngày)
  const [{ rows, total, stats, tabCounts }, creators, groups] = await Promise.all([listOrders(prisma, actor, params, now), listOrderCreators(prisma), prisma.partnerGroup.findMany({ where: { partners: { some: partnerScopeWhere(actor) } }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, patch);
  const pending = params.filters.pending?.[0] === "1", late = params.filters.late?.[0] === "1";
  const selectedTab = activeOrderTab(params);
  const canCreate = actor.perms.has("order.create") && actor.perms.has("sale_price.view");
  const filtered = !!(params.q || params.filters.delivery || params.filters.payment || params.filters.creator || params.filters.code || params.filters.customer || params.filters.group || params.filters.stock || params.filters.deliveryFrom || params.filters.deliveryTo || pending || late || params.timePreset);

  return (
    <ListPageLayout
      title="Danh sách đơn"
      description="Theo dõi đơn hàng theo trạng thái giao hàng và thanh toán"
      actions={<><Link href={buildListHref(`${BASE}/print`, params, {})} target="_blank" rel="noopener noreferrer" aria-label="In trang danh sách đang xem" title="In trang danh sách đang xem" className="flex h-11 w-11 items-center justify-center rounded-sm border border-border bg-surface hover:bg-hover"><Printer size={16} aria-hidden /></Link>{canCreate ? (
        <Link href={`${BASE}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden />Lập đơn</Link>
      ) : null}</>}
      statsClassName="grid grid-cols-2 lg:grid-cols-4"
      stats={<>
        <StatCard label="Tất cả" value={stats.all} href={href({ filters: resetOrderStatusFilters })} active={selectedTab === "all"} />
        <StatCard label="Chưa đủ tồn" value={stats.pending} tone="warning" href={href({ filters: { ...resetOrderStatusFilters, pending: ["1"] } })} active={selectedTab === "pending"} />
        <StatCard label="Chưa thanh toán" value={tabCounts.unpaid} tone="warning" href={href({ filters: { pending: [], late: [], delivery: [], payment: ["UNPAID"] } })} />
        <StatCard label="Trễ giao" value={stats.late} tone="warning" href={href({ filters: { ...resetOrderStatusFilters, late: ["1"] } })} active={selectedTab === "late"} />
      </>}
      filters={<OrderListControls params={params} counts={tabCounts} creators={creators} groups={groups.map((g) => ({ value: String(g.id), label: g.name }))} now={now} />}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => href(page)} />}
    >
      {total === 0 ? (
        <EmptyState
          kind={filtered ? "no-result" : "empty"} title={filtered ? "Không tìm thấy đơn phù hợp" : "Chưa có đơn hàng nào"}
          description={filtered ? "Thử đổi từ khóa hoặc xóa bộ lọc." : undefined}
          action={filtered ? <Link href={BASE} className="text-sm font-medium text-accent">Xóa bộ lọc</Link>
            : canCreate ? <Link href={`${BASE}/new`} className="text-sm font-medium text-accent">Lập đơn đầu tiên</Link> : undefined}
        />
      ) : <OrderTable rows={rows} params={params} />}
    </ListPageLayout>
  );
}
