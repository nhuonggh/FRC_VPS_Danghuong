import { notFound } from "next/navigation";
import { ProductPicker } from "@/components/inventory/ProductPicker";
import { StockCardTable } from "@/components/inventory/StockCardTable";
import { EmptyState, ExportButton, ListPageLayout } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { stockCard } from "@/server/inventory-reports/stock-card";

const validId = (value: string) => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2_147_483_647;

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("stock.view");
  const raw = (await searchParams).product;
  const productParam = Array.isArray(raw) ? raw[0] : raw;
  if (!productParam) return <ListPageLayout title="Thẻ kho" filters={<ProductPicker />} footer={null}><EmptyState kind="empty" title="Chọn sản phẩm để xem thẻ kho" /></ListPageLayout>;
  if (!validId(productParam)) notFound();
  const product = await prisma.product.findUnique({ where: { id: Number(productParam) }, select: { id: true, code: true, name: true, baseUnit: true } });
  if (!product) notFound();
  const rows = await stockCard(prisma, actor, product.id);
  return <ListPageLayout title="Thẻ kho" actions={<ExportButton href={`/api/inventory/ledger/export?product=${product.id}`} />} filters={<ProductPicker productId={product.id} label={`${product.code} — ${product.name}`} />} footer={null}>
    {rows.length ? <StockCardTable rows={rows} baseUnit={product.baseUnit} /> : <EmptyState kind="empty" title="Chưa có phát sinh kho" />}
  </ListPageLayout>;
}
