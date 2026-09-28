import { StockTable } from "@/components/inventory/StockTable";
import { EmptyState, ListPageLayout, PaginationFooter, SearchBox } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { onHandList } from "@/server/inventory-reports/on-hand";
const BASE = "/inventory/stock";
export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { const actor = await requireActor("stock.view"), params = parseListParams(await searchParams, []), result = await onHandList(prisma, actor, params); return <ListPageLayout title="Tồn kho hiện tại" filters={<SearchBox basePath={BASE} params={params} placeholder="Tìm mã, tên sản phẩm…" />} footer={<PaginationFooter total={result.total} page={params.page} pageSize={params.pageSize} buildHref={(p) => buildListHref(BASE, params, p)} />}>{result.total ? <StockTable rows={result.rows} /> : <EmptyState kind="empty" title="Chưa có sản phẩm" />}</ListPageLayout>; }
