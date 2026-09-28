import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { getOpenPeriod } from "@/server/period/guard";

export interface XntRow { productId: number; code: string; name: string; baseUnit: string; opening: string; inQty: string; outQty: string; closing: string; openingValue?: string; inValue?: string; outValue?: string; closingValue?: string }
/** XNT theo sổ kho: tồn đầu + nhập − xuất = tồn cuối; giá trị chỉ trả khi actor có cost.view. */
export async function xntReport(db: PrismaClient, actor: Actor, from: Date, to: Date) {
  const period = await getOpenPeriod(db);
  const products = await db.product.findMany({ orderBy: { code: "asc" } });
  const rows = await Promise.all(products.map(async (product) => {
    const [before, range] = await Promise.all([
      db.stockLedger.aggregate({ where: { periodId: period.id, productId: product.id, at: { lt: from } }, _sum: { qtyIn: true, qtyOut: true } }),
      db.stockLedger.aggregate({ where: { periodId: period.id, productId: product.id, at: { gte: from, lte: to } }, _sum: { qtyIn: true, qtyOut: true, unitCostOut: true } }),
    ]);
    const opening = new Prisma.Decimal(before._sum.qtyIn ?? 0).minus(before._sum.qtyOut ?? 0), incoming = new Prisma.Decimal(range._sum.qtyIn ?? 0), outgoing = new Prisma.Decimal(range._sum.qtyOut ?? 0);
    return { productId: product.id, code: product.code, name: product.name, baseUnit: product.baseUnit, opening: opening.toString(), inQty: incoming.toString(), outQty: outgoing.toString(), closing: opening.plus(incoming).minus(outgoing).toString() };
  }));
  return redactDeep(rows, actor.perms) as XntRow[];
}
