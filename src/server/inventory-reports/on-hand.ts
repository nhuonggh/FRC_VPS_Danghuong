import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { type ListParams } from "@/lib/query-params";
import { searchTextWhere } from "@/lib/search";
import { getOpenPeriod } from "@/server/period/guard";

export interface OnHandRow { productId: number; code: string; name: string; baseUnit: string; minStock: string; onHand: string; stockValue?: string }
/** Tồn hiện tại tính từ lớp còn lại trừ lượng xuất tạm, không lưu số dư chạy. */
export async function onHandList(db: PrismaClient, actor: Actor, params: ListParams) {
  const period = await getOpenPeriod(db), q = (params.q ?? "").trim();
  const where = searchTextWhere(q);
  const products = await db.product.findMany({ where, orderBy: { code: "asc" }, skip: (params.page - 1) * params.pageSize, take: params.pageSize });
  const total = await db.product.count({ where });
  const rows = await Promise.all(products.map(async (product) => { const values = await db.$queryRaw<{ qty: Prisma.Decimal; value: Prisma.Decimal }[]>`SELECT COALESCE(SUM("qtyRemaining"),0) AS qty, COALESCE(SUM("qtyRemaining" * "unitCost"),0) AS value FROM cost_layers WHERE "periodId"=${period.id} AND "productId"=${product.id}`; const pending = await db.stockLedger.aggregate({ where: { periodId: period.id, productId: product.id }, _sum: { qtyProvisional: true } }); const v = values[0]!; return { productId: product.id, code: product.code, name: product.name, baseUnit: product.baseUnit, minStock: product.minStock.toString(), onHand: new Prisma.Decimal(v.qty).minus(pending._sum.qtyProvisional ?? 0).toString(), stockValue: new Prisma.Decimal(v.value).toString() }; }));
  return { rows: redactDeep(rows, actor.perms) as OnHandRow[], total, periodId: period.id };
}
