import Link from "next/link";
import { notFound } from "next/navigation";
import { XntDetailTable } from "@/components/inventory/XntDetailTable";
import { EmptyState, ExportButton, ListPageLayout, QuickTimeFilter } from "@/components/ui";
import { OperationalStats } from "@/components/ui/OperationalStats";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, listTimeRange, parseTimedListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { xntDetail } from "@/server/inventory-reports/xnt-detail";

export default async function XntDetailPage({ params: routeParams, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("stock.view");
  const { id } = await routeParams;
  if (!/^\d+$/.test(id) || Number(id) <= 0 || Number(id) > 2_147_483_647) notFound();
  const params = parseTimedListParams(await searchParams), range = listTimeRange(params)!;
  const detail = await xntDetail(prisma, actor, Number(id), range.start, range.end);
  if (!detail) notFound();
  const base = `/inventory/xnt/${detail.product.id}`;
  const back = buildListHref("/inventory/xnt", params, {});
  return <ListPageLayout title={`Chi tiết xuất nhập tồn — ${detail.product.code} · ${detail.product.name}`} statsClassName="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
    stats={<OperationalStats kind="ledger" data={{ opening: detail.opening, incoming: detail.inQty, outgoing: detail.outQty, closing: detail.closing }} unit={detail.product.baseUnit} />}
    actions={<><Link href={back} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-hover">← Báo cáo xuất nhập tồn</Link><ExportButton href={buildExportHref(`/api/inventory/xnt/${detail.product.id}/export`, params)} /></>}
    filters={<QuickTimeFilter basePath={base} params={params} allowAll={false} />} footer={null}>
    {detail.rows.length ? <XntDetailTable rows={detail.rows} baseUnit={detail.product.baseUnit} /> : <EmptyState kind="no-result" title="Sản phẩm không phát sinh nhập/xuất trong khoảng này" />}
  </ListPageLayout>;
}
