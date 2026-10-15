import { Plus } from "lucide-react";
import Link from "next/link";
import { OrderTable } from "@/components/sales/OrderTable";
import { EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, QuickTimeFilter, SearchBox, StatCard } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { advanceExpectedDeliveryDates, listOrders, ORDER_FILTER_KEYS } from "@/server/sales/queries";
import { DELIVERY_LABEL, PAYMENT_LABEL } from "@/server/sales/status";

export const dynamic = "force-dynamic";
const BASE = "/sales/orders";
const DELIVERY_OPTIONS = ["WAITING_STOCK", "READY", "LOADED", "DELIVERING", "DELIVERED", "PARTIAL", "FAILED"] as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("order.view");
  const params = parseListParams(await searchParams, ORDER_FILTER_KEYS);
  const now = new Date();
  await advanceExpectedDeliveryDates(prisma, now); // ngày giao quá hạn tự dời về hôm nay (lần đầu trong ngày)
  const { rows, total, stats } = await listOrders(prisma, actor, params, now);
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, patch);
  const pending = params.filters.pending?.[0] === "1", late = params.filters.late?.[0] === "1";
  const canCreate = actor.perms.has("order.create") && actor.perms.has("sale_price.view");
  const filtered = !!(params.q || params.filters.delivery || params.filters.payment || pending || late || params.timePreset);

  return (
    <ListPageLayout
      title="Danh sách đơn"
      actions={canCreate ? (
        <Link href={`${BASE}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden />Lập đơn</Link>
      ) : undefined}
      stats={<>
        <StatCard label="Tất cả" value={stats.all} href={href({ filters: { pending: [], late: [] } })} active={!pending && !late} />
        <StatCard label="Chưa đủ tồn" value={stats.pending} tone="warning" href={href({ filters: { pending: ["1"], late: [] } })} active={pending} />
        <StatCard label="Trễ giao" value={stats.late} tone="warning" href={href({ filters: { late: ["1"], pending: [] } })} active={late} />
      </>}
      filters={
        <div className="flex flex-wrap items-end gap-2">
          <SearchBox basePath={BASE} params={params} placeholder="Tìm mã đơn, khách hàng…" />
          <QuickTimeFilter basePath={BASE} params={params} />
          <MultiSelectFilter label="Giao hàng" paramKey="delivery" basePath={BASE} params={params}
            options={DELIVERY_OPTIONS.map((v) => ({ value: v, label: DELIVERY_LABEL[v].label }))} />
          <MultiSelectFilter label="Thanh toán" paramKey="payment" basePath={BASE} params={params}
            options={(Object.keys(PAYMENT_LABEL) as (keyof typeof PAYMENT_LABEL)[]).map((v) => ({ value: v, label: PAYMENT_LABEL[v].label }))} />
        </div>
      }
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
