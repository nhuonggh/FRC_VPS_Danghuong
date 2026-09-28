import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { getOpenPeriod } from "@/server/period/guard";

export interface XntRow { productId: number; code: string; name: string; baseUnit: string; opening: string; inQty: string; outQty: string; closing: string; openingValue?: string; inValue?: string; outValue?: string; closingValue?: string }
/** XNT theo sổ kho: tồn đầu + nhập − xuất = tồn cuối; giá trị chỉ trả khi actor có cost.view. */
export interface XntTotals { opening: string; inQty: string; outQty: string; closing: string }
export async function xntReport(db: PrismaClient, actor: Actor, from: Date, to: Date): Promise<{ rows: XntRow[]; totals: XntTotals }> {
  const period = await getOpenPeriod(db);
  const [products, before, range] = await Promise.all([
    db.product.findMany({ orderBy: { code: "asc" } }),
    db.stockLedger.groupBy({ by: ["productId"], where: { periodId: period.id, at: { lt: from } }, _sum: { qtyIn: true, qtyOut: true } }),
    db.stockLedger.groupBy({ by: ["productId"], where: { periodId: period.id, at: { gte: from, lte: to } }, _sum: { qtyIn: true, qtyOut: true } }),
  ]);
  const prior = new Map(before.map((row) => [row.productId, row._sum]));
  const during = new Map(range.map((row) => [row.productId, row._sum]));
  const rows = products.map((product) => {
    const b = prior.get(product.id), r = during.get(product.id);
    const opening = new Prisma.Decimal(b?.qtyIn ?? 0).minus(b?.qtyOut ?? 0);
    const incoming = new Prisma.Decimal(r?.qtyIn ?? 0), outgoing = new Prisma.Decimal(r?.qtyOut ?? 0);
    return { productId: product.id, code: product.code, name: product.name, baseUnit: product.baseUnit, opening: opening.toString(), inQty: incoming.toString(), outQty: outgoing.toString(), closing: opening.plus(incoming).minus(outgoing).toString() };
  });
  const totals = rows.reduce<XntTotals>((sum, row) => ({ opening: new Prisma.Decimal(sum.opening).plus(row.opening).toString(), inQty: new Prisma.Decimal(sum.inQty).plus(row.inQty).toString(), outQty: new Prisma.Decimal(sum.outQty).plus(row.outQty).toString(), closing: new Prisma.Decimal(sum.closing).plus(row.closing).toString() }), { opening: "0", inQty: "0", outQty: "0", closing: "0" });
  return { rows: redactDeep(rows, actor.perms) as XntRow[], totals };
}
