import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { getOpenPeriod } from "@/server/period/guard";

export interface StockCardRow { id: number; at: Date; docType: string; docId: number; qtyIn: string; qtyOut: string; unitCost?: string; balance: string }
export interface StockCardListOptions { from?: Date; to?: Date; page: number; pageSize: number }
/** Thẻ kho theo sổ, số dư được cộng dồn theo (at, seq), không lưu cột số dư vật lý. */
export async function stockCard(db: PrismaClient, actor: Actor, productId: number) {
  const period = await getOpenPeriod(db);
  const rows = await db.stockLedger.findMany({ where: { periodId: period.id, productId }, orderBy: [{ at: "asc" }, { seq: "asc" }] });
  let balance = new Prisma.Decimal(0);
  const dto = rows.map((row) => { balance = balance.plus(row.qtyIn).minus(row.qtyOut); return { id: row.id, at: row.at, docType: row.docType, docId: row.docId, qtyIn: row.qtyIn.toString(), qtyOut: row.qtyOut.toString(), unitCost: row.unitCostOut.toString(), balance: balance.toString() }; });
  return redactDeep(dto, actor.perms) as StockCardRow[];
}

/** Thẻ kho giữ số dư chạy từ đầu kỳ, kể cả khi người dùng chỉ xem một khoảng ngày hoặc một trang. */
export async function stockCardList(db: PrismaClient, actor: Actor, productId: number, options: StockCardListOptions) {
  const rows = await stockCard(db, actor, productId);
  const filtered = rows.filter((row) => (!options.from || row.at >= options.from) && (!options.to || row.at < options.to));
  const start = (options.page - 1) * options.pageSize;
  const sum = (key: "qtyIn" | "qtyOut") => filtered.reduce((s, r) => s.plus(r[key]), new Prisma.Decimal(0));
  const before = rows.filter((r) => options.from && r.at < options.from);
  const opening = before.at(-1)?.balance ?? "0";
  return { rows: filtered.slice(start, start + options.pageSize), total: filtered.length, stats: { opening, incoming: sum("qtyIn").toString(), outgoing: sum("qtyOut").toString(), closing: new Prisma.Decimal(opening).plus(sum("qtyIn")).minus(sum("qtyOut")).toString() } };
}
