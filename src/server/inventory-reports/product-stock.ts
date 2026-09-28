import { Prisma, type PrismaClient, StockDocType } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { getOpenPeriod } from "@/server/period/guard";

export interface ProductStockLayer { id: number; at: Date; docType: StockDocType; docId: number; qtyIn: string; qtyRemaining: string; unitCost?: string }
export interface ProductStockDTO { productId: number; baseUnit: string; onHand: string; pending: string; lastPurchasePrice?: string; stockValue?: string; layers: ProductStockLayer[] }

/** Tồn của một sản phẩm: mọi field giá được redact ngay tại service trước khi đến page/UI/export. */
export async function productStock(db: PrismaClient, actor: Actor, productId: number): Promise<ProductStockDTO> {
  const period = await getOpenPeriod(db);
  const [product, layers, provisional] = await Promise.all([
    db.product.findUniqueOrThrow({ where: { id: productId }, select: { baseUnit: true } }),
    db.costLayer.findMany({
      where: { periodId: period.id, productId, qtyRemaining: { gt: 0 } },
      orderBy: [{ at: "asc" }, { id: "asc" }],
      include: { ledger: { select: { docType: true, docId: true } } },
    }),
    db.stockLedger.aggregate({ where: { periodId: period.id, productId }, _sum: { qtyProvisional: true } }),
  ]);
  const qtyRemaining = layers.reduce((sum, layer) => sum.plus(layer.qtyRemaining), new Prisma.Decimal(0));
  const stockValue = layers.reduce((sum, layer) => sum.plus(layer.qtyRemaining.mul(layer.unitCost)), new Prisma.Decimal(0));
  const lastPurchase = [...layers].reverse().find((layer) => layer.sourceDocType === "PURCHASE")?.unitCost;
  const dto: ProductStockDTO = {
    productId, baseUnit: product.baseUnit, onHand: qtyRemaining.minus(provisional._sum.qtyProvisional ?? 0).toString(), pending: (provisional._sum.qtyProvisional ?? new Prisma.Decimal(0)).toString(),
    lastPurchasePrice: lastPurchase?.toString(), stockValue: stockValue.toString(),
    layers: layers.map((layer) => ({ id: layer.id, at: layer.at, docType: layer.ledger.docType, docId: layer.ledger.docId, qtyIn: layer.qtyIn.toString(), qtyRemaining: layer.qtyRemaining.toString(), unitCost: layer.unitCost.toString() })),
  };
  return redactDeep(dto, actor.perms) as ProductStockDTO;
}
