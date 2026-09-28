import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { getOpenPeriod } from "@/server/period/guard";

export interface StockCardRow { id: number; at: Date; docType: string; docId: number; qtyIn: string; qtyOut: string; unitCost?: string; balance: string }
/** Thẻ kho theo sổ, số dư được cộng dồn theo (at, seq), không lưu cột số dư vật lý. */
export async function stockCard(db: PrismaClient, actor: Actor, productId: number) {
  const period = await getOpenPeriod(db);
  const rows = await db.stockLedger.findMany({ where: { periodId: period.id, productId }, orderBy: [{ at: "asc" }, { seq: "asc" }] });
  let balance = new Prisma.Decimal(0);
  const dto = rows.map((row) => { balance = balance.plus(row.qtyIn).minus(row.qtyOut); return { id: row.id, at: row.at, docType: row.docType, docId: row.docId, qtyIn: row.qtyIn.toString(), qtyOut: row.qtyOut.toString(), unitCost: row.unitCostOut.toString(), balance: balance.toString() }; });
  return redactDeep(dto, actor.perms) as StockCardRow[];
}
