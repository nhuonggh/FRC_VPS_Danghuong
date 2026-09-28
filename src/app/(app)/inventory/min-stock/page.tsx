import { StockTable } from "@/components/inventory/StockTable";
import { EmptyState, ListPageLayout, PaginationFooter } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { onHandList } from "@/server/inventory-reports/on-hand";
const BASE = "/inventory/min-stock";
export default async function MinStockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { const actor = await requireActor("stock.view"), params = parseListParams(await searchParams, []), data = await onHandList(prisma, actor, params), rows = data.rows.filter((row) => Number(row.minStock) > 0 && Number(row.onHand) < Number(row.minStock)); return <ListPageLayout title="Cảnh báo định mức tồn" footer={<PaginationFooter total={rows.length} page={params.page} pageSize={params.pageSize} buildHref={(p) => buildListHref(BASE, params, p)} />}>{rows.length ? <StockTable rows={rows} /> : <EmptyState kind="empty" title="Không có mã hàng dưới định mức" />}</ListPageLayout>; }
