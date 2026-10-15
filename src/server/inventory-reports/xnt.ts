import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { getOpenPeriod } from "@/server/period/guard";

export interface XntRow { productId: number; code: string; name: string; baseUnit: string; opening: string; inQty: string; outQty: string; closing: string; openingValue?: string; inValue?: string; outValue?: string; closingValue?: string }
/** XNT theo sổ kho: tồn đầu + nhập − xuất = tồn cuối; giá trị chỉ trả khi actor có cost.view. */
export interface XntTotals { opening: string; inQty: string; outQty: string; closing: string; openingValue?: string; inValue?: string; outValue?: string; closingValue?: string }
export interface XntListOptions { from: Date; to: Date; q?: string; page: number; pageSize: number }
export async function xntReport(db: PrismaClient, actor: Actor, from: Date, to: Date): Promise<{ rows: XntRow[]; totals: XntTotals }> {
  const period = await getOpenPeriod(db);
  // Giá trị dùng đúng khoảng nửa mở [from, to), giống số lượng trên sổ kho.
  const sums = (where: Prisma.Sql) => db.$queryRaw<{ productId: number; inValue: Prisma.Decimal; outValue: Prisma.Decimal }[]>`
    SELECT sl."productId", COALESCE(SUM(CASE WHEN sl."qtyIn" > 0 THEN sl."qtyIn" * cl."unitCost" ELSE 0 END), 0) AS "inValue", COALESCE(SUM(sl."qtyOut" * sl."unitCostOut"), 0) AS "outValue"
    FROM stock_ledger sl LEFT JOIN cost_layers cl ON cl."ledgerId" = sl.id
    WHERE sl."periodId" = ${period.id} AND ${where}
    GROUP BY sl."productId"`;
  const [products, before, range, beforeValues, rangeValues] = await Promise.all([
    db.product.findMany({ orderBy: { code: "asc" } }),
    db.stockLedger.groupBy({ by: ["productId"], where: { periodId: period.id, at: { lt: from } }, _sum: { qtyIn: true, qtyOut: true } }),
    db.stockLedger.groupBy({ by: ["productId"], where: { periodId: period.id, at: { gte: from, lt: to } }, _sum: { qtyIn: true, qtyOut: true } }),
    sums(Prisma.sql`sl.at < ${from}`), sums(Prisma.sql`sl.at >= ${from} AND sl.at < ${to}`),
  ]);
  const prior = new Map(before.map((row) => [row.productId, row._sum]));
  const during = new Map(range.map((row) => [row.productId, row._sum]));
  const priorValues = new Map(beforeValues.map((row) => [row.productId, row]));
  const periodValues = new Map(rangeValues.map((row) => [row.productId, row]));
  const rows = products.map((product) => {
    const b = prior.get(product.id), r = during.get(product.id);
    const opening = new Prisma.Decimal(b?.qtyIn ?? 0).minus(b?.qtyOut ?? 0);
    const incoming = new Prisma.Decimal(r?.qtyIn ?? 0), outgoing = new Prisma.Decimal(r?.qtyOut ?? 0);
    const pv = priorValues.get(product.id), rv = periodValues.get(product.id), openingValue = new Prisma.Decimal(pv?.inValue ?? 0).minus(pv?.outValue ?? 0), inValue = new Prisma.Decimal(rv?.inValue ?? 0), outValue = new Prisma.Decimal(rv?.outValue ?? 0);
    return { productId: product.id, code: product.code, name: product.name, baseUnit: product.baseUnit, opening: opening.toString(), inQty: incoming.toString(), outQty: outgoing.toString(), closing: opening.plus(incoming).minus(outgoing).toString(), openingValue: openingValue.toString(), inValue: inValue.toString(), outValue: outValue.toString(), closingValue: openingValue.plus(inValue).minus(outValue).toString() };
  });
  const totals = rows.reduce<XntTotals>((sum, row) => ({ opening: new Prisma.Decimal(sum.opening).plus(row.opening).toString(), inQty: new Prisma.Decimal(sum.inQty).plus(row.inQty).toString(), outQty: new Prisma.Decimal(sum.outQty).plus(row.outQty).toString(), closing: new Prisma.Decimal(sum.closing).plus(row.closing).toString(), openingValue: new Prisma.Decimal(sum.openingValue ?? 0).plus(row.openingValue!).toString(), inValue: new Prisma.Decimal(sum.inValue ?? 0).plus(row.inValue!).toString(), outValue: new Prisma.Decimal(sum.outValue ?? 0).plus(row.outValue!).toString(), closingValue: new Prisma.Decimal(sum.closingValue ?? 0).plus(row.closingValue!).toString() }), { opening: "0", inQty: "0", outQty: "0", closing: "0", openingValue: "0", inValue: "0", outValue: "0", closingValue: "0" });
  // Tổng giá trị cũng là dữ liệu nhạy cảm, phải redaction cùng các dòng.
  return redactDeep({ rows, totals }, actor.perms) as { rows: XntRow[]; totals: XntTotals };
}

/** Danh sách XNT có tìm kiếm và phân trang; totals luôn tính trên toàn bộ tập đã lọc. */
export async function xntList(db: PrismaClient, actor: Actor, options: XntListOptions): Promise<{ rows: XntRow[]; total: number; totals: XntTotals }> {
  const report = await xntReport(db, actor, options.from, options.to);
  const needle = options.q?.trim().toLocaleLowerCase("vi-VN");
  const matched = needle ? report.rows.filter((row) => `${row.code} ${row.name}`.toLocaleLowerCase("vi-VN").includes(needle)) : report.rows;
  const totals = matched.reduce<XntTotals>((sum, row) => ({
    opening: new Prisma.Decimal(sum.opening).plus(row.opening).toString(), inQty: new Prisma.Decimal(sum.inQty).plus(row.inQty).toString(), outQty: new Prisma.Decimal(sum.outQty).plus(row.outQty).toString(), closing: new Prisma.Decimal(sum.closing).plus(row.closing).toString(),
    ...(row.openingValue !== undefined ? { openingValue: new Prisma.Decimal(sum.openingValue ?? 0).plus(row.openingValue).toString(), inValue: new Prisma.Decimal(sum.inValue ?? 0).plus(row.inValue ?? 0).toString(), outValue: new Prisma.Decimal(sum.outValue ?? 0).plus(row.outValue ?? 0).toString(), closingValue: new Prisma.Decimal(sum.closingValue ?? 0).plus(row.closingValue ?? 0).toString() } : {}),
  }), { opening: "0", inQty: "0", outQty: "0", closing: "0" });
  const start = (options.page - 1) * options.pageSize;
  return { rows: matched.slice(start, start + options.pageSize), total: matched.length, totals };
}
