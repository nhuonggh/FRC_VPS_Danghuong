import { notFound } from "next/navigation";
import { ProductPicker } from "@/components/inventory/ProductPicker";
import { StockCardTable } from "@/components/inventory/StockCardTable";
import { EmptyState, ExportButton, ListPageLayout, PaginationFooter, QuickTimeFilter } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, listTimeRange, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { stockCardList } from "@/server/inventory-reports/stock-card";

const validId = (value: string) => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2_147_483_647;

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("stock.view");
  const allParams = await searchParams;
  const raw = allParams.product;
  const productParam = Array.isArray(raw) ? raw[0] : raw;
  if (!productParam) return <ListPageLayout title="Thẻ kho" filters={<ProductPicker />} footer={null}><EmptyState kind="empty" title="Chọn sản phẩm để xem thẻ kho" /></ListPageLayout>;
  if (!validId(productParam)) notFound();
  const product = await prisma.product.findUnique({ where: { id: Number(productParam) }, select: { id: true, code: true, name: true, baseUnit: true } });
  if (!product) notFound();
  const params = parseListParams(allParams);
  const range = listTimeRange(params);
  const result = await stockCardList(prisma, actor, product.id, { from: range?.start, to: range?.end, page: params.page, pageSize: params.pageSize });
  return <ListPageLayout title="Thẻ kho" actions={<ExportButton href={buildExportHref(`/api/inventory/ledger/export?product=${product.id}`, params)} />} filters={<div className="flex flex-wrap items-end gap-2"><ProductPicker productId={product.id} label={`${product.code} — ${product.name}`} /><QuickTimeFilter basePath={`/inventory/ledger?product=${product.id}`} params={params} /></div>} footer={<PaginationFooter total={result.total} page={params.page} pageSize={params.pageSize} buildHref={(patch) => buildListHref(`/inventory/ledger?product=${product.id}`, params, patch)} />}>
    {result.total ? <StockCardTable rows={result.rows} baseUnit={product.baseUnit} /> : <EmptyState kind="empty" title="Chưa có phát sinh kho trong khoảng này" />}
  </ListPageLayout>;
}
