import type { Prisma, PrismaClient } from "@prisma/client";
export async function lastPurchaseCost(db: Prisma.TransactionClient | PrismaClient, productId: number): Promise<Prisma.Decimal | null> {
  const row = await db.costLayer.findFirst({ where: { productId, sourceDocType: "PURCHASE" }, orderBy: [{ at: "desc" }, { ledger: { seq: "desc" } }], select: { unitCost: true } });
  return row?.unitCost ?? null;
}
