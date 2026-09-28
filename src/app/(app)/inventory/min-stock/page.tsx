import { StockTable } from "@/components/inventory/StockTable";
import { EmptyState, ExportButton, ListPageLayout, PaginationFooter } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { onHandList, STOCK_FILTER_KEYS } from "@/server/inventory-reports/on-hand";
const BASE = "/inventory/min-stock";
export default async function MinStockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { const actor = await requireActor("stock.view"), params = parseListParams(await searchParams, STOCK_FILTER_KEYS), data = await onHandList(prisma, actor, params, { belowMinOnly: true }); return <ListPageLayout title="Cảnh báo định mức tồn" actions={<ExportButton href={buildExportHref("/api/inventory/min-stock/export", params)} />} footer={<PaginationFooter total={data.total} page={params.page} pageSize={params.pageSize} buildHref={(p) => buildListHref(BASE, params, p)} />}>{data.total ? <StockTable rows={data.rows} mode="min" /> : <EmptyState kind="empty" title="Không có mã hàng dưới định mức" />}</ListPageLayout>; }
