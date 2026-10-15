import Link from "next/link";
import { notFound } from "next/navigation";
import { ClosedPeriodBanner, OverviewTab, PeriodTabs, ReadTable } from "@/components/period/PeriodHistoryViews";
import { EmptyState, ListPageLayout, PaginationFooter, SearchBox } from "@/components/ui";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency, formatDate, formatQty } from "@/lib/format";
import { can } from "@/lib/permissions/guard";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getPeriodOrThrow, periodCash, periodDebts, periodOrders, periodOverview, periodStock } from "@/server/period/history";
import { DELIVERY_LABEL } from "@/server/sales/status";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PeriodHistoryDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const actor = await requireActor("period.view_closed");
  const raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0 || Number(raw) > 2_147_483_647) notFound();
  const id = Number(raw);
  const sp = await searchParams;
  const period = await getPeriodOrThrow(prisma, actor, id).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });

  const tabs = [
    { key: "overview", label: "Tổng quan", ok: true },
    { key: "stock", label: "Tồn kho (XNT)", ok: can(actor.perms, "stock.view") },
    { key: "debt", label: "Công nợ", ok: can(actor.perms, "debt.view") },
    { key: "cash", label: "Quỹ", ok: can(actor.perms, "cashbook.view") },
    { key: "orders", label: "Đơn hàng", ok: can(actor.perms, "order.view") },
  ].filter((t) => t.ok);
  const wanted = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = tabs.find((t) => t.key === wanted)?.key ?? "overview";
  const tabPath = `/period/history/${id}?tab=${tab}`;
  const lp = parseListParams(sp);
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(tabPath, lp, patch);
  const pageOf = <T,>(rows: T[]): T[] => rows.slice((lp.page - 1) * lp.pageSize, lp.page * lp.pageSize);

  const header = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/period/history" className="text-sm text-accent hover:underline">← Tất cả kỳ</Link>
        <h1 className="text-xl font-semibold">{period.name}</h1>
        {period.status === "OPEN" ? <Badge tone="success">Đang mở</Badge> : <Badge tone="neutral">Đã kết sổ</Badge>}
        <span className="text-sm text-fg-secondary">Mở {formatDate(period.openedAt)}{period.closedAt ? ` · kết ${formatDate(period.closedAt)}` : ""}</span>
      </div>
      {period.status === "CLOSED" && <ClosedPeriodBanner periodName={period.name} closedAt={period.closedAt} />}
      <PeriodTabs id={id} active={tab} tabs={tabs} />
    </div>
  );

  if (tab === "overview") {
    return <div className="mx-auto w-full max-w-6xl space-y-4">{header}<OverviewTab o={await periodOverview(prisma, actor, id)} /></div>;
  }

  const list = (title: string, total: number, body: React.ReactNode, withSearch = true) => (
    <ListPageLayout
      title={title}
      filters={<div className="space-y-3">{header}{withSearch && <SearchBox basePath={tabPath} params={lp} placeholder="Tìm…" />}</div>}
      footer={<PaginationFooter total={total} page={lp.page} pageSize={lp.pageSize} buildHref={href} />}
    >
      {total ? body : <EmptyState kind="no-result" title="Không có dữ liệu trong kỳ này" />}
    </ListPageLayout>
  );

  if (tab === "stock") {
    const rows = await periodStock(prisma, actor, id, lp.q);
    const cost = can(actor.perms, "cost.view");
    return list("Xuất nhập tồn của kỳ", rows.length, (
      <ReadTable rowKey={(r) => r.productId} rows={pageOf(rows)} columns={[
        { label: "Mã", render: (r) => <Link href={`/inventory/products/${r.productId}`} className="text-accent hover:underline">{r.code}</Link> },
        { label: "Tên hàng", render: (r) => r.name }, { label: "ĐVT", render: (r) => r.unit },
        { label: "Đầu kỳ", align: "right", render: (r) => formatQty(r.opening) }, { label: "Nhập", align: "right", render: (r) => formatQty(r.inQty) },
        { label: "Xuất", align: "right", render: (r) => formatQty(r.outQty) }, { label: "Cuối kỳ", align: "right", render: (r) => formatQty(r.closing) },
        ...(cost ? [{ label: "Giá trị cuối kỳ", align: "right" as const, render: (r: (typeof rows)[number]) => formatCurrency(r.closingValue) }] : []),
      ]} />
    ));
  }
  if (tab === "debt") {
    const rows = await periodDebts(prisma, actor, id, lp.q);
    return list("Công nợ đối tác trong kỳ", rows.length, (
      <ReadTable rowKey={(r) => r.partnerId} rows={pageOf(rows)} columns={[
        { label: "Mã", render: (r) => <Link href={`/accounting/debts/${r.partnerId}`} className="text-accent hover:underline">{r.code}</Link> },
        { label: "Đối tác", render: (r) => r.name }, { label: "Đầu kỳ", align: "right", render: (r) => formatCurrency(r.opening) },
        { label: "Phát sinh nợ", align: "right", render: (r) => formatCurrency(r.debit) }, { label: "Phát sinh có", align: "right", render: (r) => formatCurrency(r.credit) },
        { label: "Cuối kỳ", align: "right", render: (r) => formatCurrency(r.closing) },
      ]} />
    ));
  }
  if (tab === "cash") {
    const rows = await periodCash(prisma, actor, id);
    return list("Quỹ / ngân hàng trong kỳ", rows.length, (
      <ReadTable rowKey={(r) => r.accountId} rows={rows} columns={[
        { label: "Quỹ / tài khoản", render: (r) => r.name }, { label: "Loại", render: (r) => (r.type === "CASH" ? "Tiền mặt" : "Ngân hàng") },
        { label: "Đầu kỳ", align: "right", render: (r) => formatCurrency(r.opening) }, { label: "Thu", align: "right", render: (r) => formatCurrency(r.amountIn) },
        { label: "Chi", align: "right", render: (r) => formatCurrency(r.amountOut) }, { label: "Cuối kỳ", align: "right", render: (r) => formatCurrency(r.closing) },
      ]} />
    ), false);
  }
  const orders = await periodOrders(prisma, actor, id, { q: lp.q, page: lp.page, pageSize: lp.pageSize });
  const showTotal = can(actor.perms, "sale_price.view");
  return list("Đơn hàng của kỳ", orders.total, (
    <ReadTable rowKey={(r) => r.id} rows={orders.rows} columns={[
      { label: "Mã đơn", render: (r) => <Link href={`/sales/orders/${r.id}`} className="text-accent hover:underline">{r.code}</Link> },
      { label: "Ngày", render: (r) => formatDate(r.orderDate) }, { label: "Khách hàng", render: (r) => r.partnerName },
      { label: "Trạng thái", render: (r) => (r.status in DELIVERY_LABEL ? DELIVERY_LABEL[r.status as keyof typeof DELIVERY_LABEL].label : r.status) },
      ...(showTotal ? [{ label: "Tổng tiền", align: "right" as const, render: (r: (typeof orders.rows)[number]) => formatCurrency(r.total) }] : []),
    ]} />
  ));
}
