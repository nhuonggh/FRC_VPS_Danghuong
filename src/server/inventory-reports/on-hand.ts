import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { type ListParams } from "@/lib/query-params";
import { searchTextWhere } from "@/lib/search";
import { getOpenPeriod } from "@/server/period/guard";

export interface OnHandRow { productId: number; code: string; name: string; baseUnit: string; minStock: string; onHand: string; stockValue?: string }
/** Tồn hiện tại tính từ lớp còn lại trừ lượng xuất tạm, không lưu số dư chạy. */
export async function onHandList(db: PrismaClient, actor: Actor, params: ListParams, options: { belowMinOnly?: boolean; unpaged?: boolean } = {}) {
  const period = await getOpenPeriod(db), q = (params.q ?? "").trim();
  const where = searchTextWhere(q);
  // Tổng hợp theo mã hàng ở DB rồi ghép trong bộ nhớ: tránh N+1 (1.300 mã không tạo hàng nghìn query).
  const [products, layers, pending] = await Promise.all([
    db.product.findMany({ where, orderBy: { code: "asc" } }),
    db.costLayer.groupBy({ by: ["productId"], where: { periodId: period.id }, _sum: { qtyRemaining: true, unitCost: true } }),
    db.stockLedger.groupBy({ by: ["productId"], where: { periodId: period.id }, _sum: { qtyProvisional: true } }),
  ]);
  const layerByProduct = new Map(layers.map((row) => [row.productId, row]));
  const pendingByProduct = new Map(pending.map((row) => [row.productId, row._sum.qtyProvisional ?? new Prisma.Decimal(0)]));
  const all = products.map((product) => {
    const layer = layerByProduct.get(product.id);
    // groupBy không tính được SUM(qtyRemaining * unitCost); giá trị tồn dùng raw SQL theo toàn kỳ ở bước sau.
    const qty = layer?._sum.qtyRemaining ?? new Prisma.Decimal(0);
    const onHand = new Prisma.Decimal(qty).minus(pendingByProduct.get(product.id) ?? 0);
    return { productId: product.id, code: product.code, name: product.name, baseUnit: product.baseUnit, minStock: product.minStock.toString(), onHand: onHand.toString() };
  }).filter((row) => !options.belowMinOnly || (new Prisma.Decimal(row.minStock).greaterThan(0) && new Prisma.Decimal(row.onHand).lessThan(row.minStock)));
  const values = await db.$queryRaw<{ productId: number; stockValue: Prisma.Decimal }[]>`SELECT "productId", COALESCE(SUM("qtyRemaining" * "unitCost"), 0) AS "stockValue" FROM cost_layers WHERE "periodId"=${period.id} GROUP BY "productId"`;
  const valueByProduct = new Map(values.map((row) => [row.productId, row.stockValue.toString()]));
  const total = all.length, start = options.unpaged ? 0 : (params.page - 1) * params.pageSize;
  const rows = (options.unpaged ? all : all.slice(start, start + params.pageSize)).map((row) => ({ ...row, stockValue: valueByProduct.get(row.productId) ?? "0" }));
  return { rows: redactDeep(rows, actor.perms) as OnHandRow[], total, periodId: period.id };
}
