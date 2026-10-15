import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { type ListParams } from "@/lib/query-params";
import { searchTextWhere } from "@/lib/search";
import { getOpenPeriod } from "@/server/period/guard";

export const STOCK_FILTER_KEYS = ["stock", "kind"] as const;
export interface OnHandRow { productId: number; code: string; name: string; kind: string; baseUnit: string; minStock: string; onHand: string; pending: string; shortage: string | null; stockValue?: string }
/** Tồn hiện tại tính từ lớp còn lại trừ lượng xuất tạm, không lưu số dư chạy. */
export async function onHandList(db: PrismaClient, actor: Actor, params: ListParams, options: { belowMinOnly?: boolean; unpaged?: boolean } = {}) {
  const period = await getOpenPeriod(db), q = (params.q ?? "").trim();
  const kinds = params.filters.kind?.filter((value) => ["HANG", "NVL", "THANH_PHAM", "PHU_KIEN"].includes(value));
  const stock = params.filters.stock?.[0];
  const where = { AND: [searchTextWhere(q), ...(kinds?.length ? [{ kind: { in: kinds as never } }] : [])] };
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
    const pending = pendingByProduct.get(product.id) ?? new Prisma.Decimal(0);
    const shortage = new Prisma.Decimal(product.minStock).minus(onHand);
    return { productId: product.id, code: product.code, name: product.name, kind: product.kind, baseUnit: product.baseUnit, minStock: product.minStock.toString(), onHand: onHand.toString(), pending: pending.toString(), shortage: shortage.gt(0) ? shortage.toString() : null };
  }).filter((row) => {
    const below = new Prisma.Decimal(row.minStock).greaterThan(0) && new Prisma.Decimal(row.onHand).lessThan(row.minStock);
    if (options.belowMinOnly && !below) return false;
    if (stock === "below" && !below) return false;
    if (stock === "pending" && new Prisma.Decimal(row.pending).lte(0)) return false;
    return true;
  });
  const values = await db.$queryRaw<{ productId: number; stockValue: Prisma.Decimal }[]>`SELECT "productId", COALESCE(SUM("qtyRemaining" * "unitCost"), 0) AS "stockValue" FROM cost_layers WHERE "periodId"=${period.id} GROUP BY "productId"`;
  const valueByProduct = new Map(values.map((row) => [row.productId, row.stockValue.toString()]));
  const total = all.length, start = options.unpaged ? 0 : (params.page - 1) * params.pageSize;
  const rows = (options.unpaged ? all : all.slice(start, start + params.pageSize)).map((row) => ({ ...row, stockValue: valueByProduct.get(row.productId) ?? "0" }));
  const stats = { products: all.length, inStock: all.filter((row) => new Prisma.Decimal(row.onHand).gt(0)).length, below: all.filter((row) => row.shortage !== null).length, pending: all.filter((row) => new Prisma.Decimal(row.pending).gt(0)).length };
  return { rows: redactDeep(rows, actor.perms) as OnHandRow[], total, periodId: period.id, stats };
}
