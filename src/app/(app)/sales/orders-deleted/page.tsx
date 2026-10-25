import Link from "next/link";
import { RestoreButton } from "@/components/sales/RestoreButton";
import { DeletedOrderControls } from "@/components/sales/DeletedOrderControls";
import { EmptyState, ListPageLayout, PaginationFooter } from "@/components/ui";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { buildListHref, listTimeRange, parseTimedListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listDeletedOrders } from "@/server/sales/queries";

export const dynamic = "force-dynamic";
const BASE = "/sales/orders-deleted";

export default async function DeletedOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("order.restore");
  const params = parseTimedListParams(await searchParams, ["customer"]);
  // ASSUMPTION: giữ mặc định mọi thời gian để các đơn cũ vẫn xuất hiện khi mở trang.
  const now = new Date();
  const { rows, total, amount, customers, counts } = await listDeletedOrders(prisma, actor, params, now);
  const canView = actor.perms.has("order.view");
  const canPrice = actor.perms.has("sale_price.view");
  const range = listTimeRange(params, now);
  const rangeLabel = range ? `${formatDate(range.start)} – ${formatDate(new Date(range.end.getTime() - 1))}` : "Toàn bộ thời gian";
  const filtered = !!(params.q || params.timePreset || params.filters.customer?.length);
  const orderCode = (r: typeof rows[number]) => canView ? <Link href={`/sales/orders/${r.id}`} className="font-mono text-xs font-semibold text-accent hover:underline">{r.code}</Link> : <span className="font-mono text-xs font-semibold">{r.code}</span>;
  const reason = (text: string | null) => text ? <span className="inline-block rounded-full bg-danger-soft px-2 py-1 text-xs font-medium text-danger">{text}</span> : <span className="text-fg-secondary">—</span>;
  return (
    <ListPageLayout title="Đơn đã xóa" description="Xem lại các đơn đã hủy và khôi phục khi cần."
      statsClassName="grid grid-cols-1 md:grid-cols-3"
      stats={<>{[
        { label: "Số đơn trong bộ lọc", value: formatNumber(total), tone: "text-fg" },
        ...(canPrice ? [{ label: "Tổng giá trị đã hủy", value: formatCurrency(amount), tone: "text-danger" }] : []),
        { label: "Khoảng thời gian", value: rangeLabel, tone: "text-fg", compact: true },
      ].map((stat) => <div key={stat.label} className="min-w-0 rounded-md border border-border bg-surface p-4"><p className="text-xs text-fg-secondary">{stat.label}</p><p className={`mt-1 font-semibold tabular-nums ${stat.compact ? "text-lg" : "text-2xl"} ${stat.tone}`}>{stat.value}</p></div>)}</>}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      <DeletedOrderControls params={params} customers={customers} counts={counts} now={now} />
      {rows.length === 0 ? <EmptyState kind={filtered ? "no-result" : "empty"} title={filtered ? "Không có đơn đã xóa trong khoảng này" : "Chưa có đơn đã hủy"}
        description="Thử chọn khoảng thời gian rộng hơn hoặc bấm Tất cả."
        action={filtered || params.page > 1 ? <Link href={BASE} className="text-sm font-medium text-accent">Xóa bộ lọc</Link> : undefined} /> : <>
        <table className="hidden w-full text-sm md:table">
          <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
            <th className="px-4 py-3">Mã đơn</th><th className="px-4 py-3">Ngày đơn</th><th className="px-4 py-3">Khách hàng</th>
            {canPrice && <th className="px-4 py-3 text-right">Giá trị</th>}
            <th className="px-4 py-3">Hủy lúc</th><th className="px-4 py-3">Lý do</th><th className="px-4 py-3"><span className="sr-only">Thao tác</span></th>
          </tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-border align-top hover:bg-hover">
            <td className="px-4 py-4">{orderCode(r)}</td><td className="whitespace-nowrap px-4 py-4 text-fg-secondary">{formatDate(r.orderDate)}</td><td className="px-4 py-4">{r.partnerName}</td>
            {canPrice && <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">{formatCurrency(r.orderTotal)}</td>}
            <td className="px-4 py-4 text-fg-secondary"><span className="whitespace-nowrap">{formatDateTime(r.cancelledAt)}</span><span className="mt-1 block text-xs">{r.cancelledByName ?? "—"}</span></td>
            <td className="px-4 py-4">{reason(r.cancelReason)}</td><td className="px-4 py-4 text-right"><RestoreButton orderId={r.id} code={r.code} iconOnly /></td>
          </tr>)}</tbody>
        </table>
        <div className="space-y-3 p-3 md:hidden">{rows.map((r) => <article key={r.id} className="rounded-md border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">{orderCode(r)}{reason(r.cancelReason)}</div>
          <p className="mt-3 font-medium">{r.partnerName}</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-fg-secondary">Ngày đơn</dt><dd>{formatDate(r.orderDate)}</dd></div>
            {canPrice && <div className="flex justify-between gap-3"><dt className="text-fg-secondary">Giá trị</dt><dd className="font-semibold tabular-nums">{formatCurrency(r.orderTotal)}</dd></div>}
            <div className="flex justify-between gap-3"><dt className="text-fg-secondary">Hủy lúc</dt><dd className="text-right">{formatDateTime(r.cancelledAt)}<span className="block text-xs text-fg-secondary">{r.cancelledByName ?? "—"}</span></dd></div>
          </dl>
          <div className="mt-3 flex justify-end"><RestoreButton orderId={r.id} code={r.code} iconOnly /></div>
        </article>)}</div>
      </>}
    </ListPageLayout>
  );
}
