import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { sortToOrderBy, type ListParams } from "@/lib/query-params";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import { docTimestamp, PeriodClosedError, postReceipt, productsOfDocument, removeDocument, withInventoryTx, type EngineCtx } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";
import { adjustmentInSchema, type AdjustmentInInput } from "./adjustment-schemas";
import { formatDocCode, nextDocId } from "./codes";
import { lastPurchaseCost } from "./last-cost";

export { adjustmentInSchema, type AdjustmentInInput };
const uniqueSorted = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);
const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

export async function createAdjustmentIn(ctx: EngineCtx, actor: Actor, input: AdjustmentInInput, now = new Date()) {
  assertCan(actor.perms, "stock_adjust.manage");
  if (input.lines.some((line) => line.unitCost !== null)) assertCan(actor.perms, "cost.view");
  const products = await ctx.tx.product.findMany({ where: { id: { in: uniqueSorted(input.lines.map((line) => line.productId)) } } });
  const byId = new Map(products.map((product) => [product.id, product]));
  const costs: Prisma.Decimal[] = [];
  for (const [index, line] of input.lines.entries()) {
    const product = byId.get(line.productId);
    if (!product) throw new DomainError(`Dòng ${index + 1}: sản phẩm không tồn tại.`, 400);
    if (!product.isActive) throw new DomainError(`Dòng ${index + 1}: sản phẩm ${product.code} đã ngừng bán.`, 400);
    const cost = line.unitCost === null ? await lastPurchaseCost(ctx.tx, product.id) : decimal(line.unitCost);
    if (cost === null) throw new DomainError(`Chưa có giá nhập gần nhất của ${product.code} — hãy nhập đơn giá (cần quyền xem giá vốn) hoặc lập phiếu nhập mua trước.`, 400);
    costs.push(cost);
  }
  const id = await nextDocId(ctx.tx, "stock_adjustments"), code = formatDocCode("NK", id), at = docTimestamp(input.date, now);
  await ctx.tx.stockAdjustment.create({ data: { id, code, periodId: ctx.period.id, type: "IN_NO_SUPPLIER", at, note: input.note || null, createdBy: actor.userId } });
  for (const [index, line] of input.lines.entries()) {
    const row = await ctx.tx.stockAdjustmentLine.create({ data: { adjustmentId: id, productId: line.productId, qty: decimal(line.qty), unitCost: costs[index]! } });
    const { seq } = await postReceipt(ctx, { productId: line.productId, qty: line.qty, unitCost: costs[index]!, docType: "ADJ_IN", docId: id, docLineId: row.id, at });
    await ctx.tx.stockAdjustmentLine.update({ where: { id: row.id }, data: { seq } });
  }
  await writeAudit(ctx.tx, { userId: actor.userId, action: "stock_adjustment.create", entity: "StockAdjustment", entityId: id, after: { code, type: "IN_NO_SUPPLIER", lineCount: input.lines.length } });
  return { id, code };
}

export async function createAdjustmentInIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: AdjustmentInInput) {
  assertCan(actor.perms, "stock_adjust.manage");
  return withIdempotentInventoryTx(prisma, { userId: actor.userId, products: uniqueSorted(input.lines.map((line) => line.productId)), scope: "stock_adjustment_in.create", key }, (ctx) => createAdjustmentIn(ctx, actor, input));
}

export async function cancelAdjustmentIn(ctx: EngineCtx, actor: Actor, id: number, reason: string) {
  assertCan(actor.perms, "stock_adjust.manage");
  await ctx.tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${id} FOR UPDATE`;
  const current = await ctx.tx.stockAdjustment.findUnique({ where: { id } });
  if (!current || current.type !== "IN_NO_SUPPLIER") throw new DomainError("Không tìm thấy phiếu nhập kho.", 404);
  if (current.isCancelled) throw new DomainError("Phiếu đã hủy trước đó.", 409);
  if (current.periodId !== ctx.period.id) throw new PeriodClosedError();
  await removeDocument(ctx, "ADJ_IN", id);
  await ctx.tx.stockAdjustment.update({ where: { id }, data: { isCancelled: true, cancelledAt: new Date(), cancelledBy: actor.userId, cancelReason: reason } });
  await writeAudit(ctx.tx, { userId: actor.userId, action: "stock_adjustment.cancel", entity: "StockAdjustment", entityId: id, before: { code: current.code }, after: { isCancelled: true, reason } });
}

export async function cancelAdjustmentInTx(prisma: PrismaClient, actor: Actor, id: number, reason: string) {
  const pre = await prisma.stockAdjustment.findUnique({ where: { id }, select: { periodId: true } });
  if (!pre) throw new DomainError("Không tìm thấy phiếu nhập kho.", 404);
  return withInventoryTx(prisma, { userId: actor.userId, periodId: pre.periodId, products: await productsOfDocument(prisma, "ADJ_IN", id) }, (ctx) => cancelAdjustmentIn(ctx, actor, id, reason));
}

export interface AdjustmentRowDTO { id: number; code: string; at: Date; note: string | null; lineCount: number; isCancelled: boolean; createdByName: string | null }
export interface AdjustmentDetailDTO extends Omit<AdjustmentRowDTO, "lineCount"> { cancelReason: string | null; lines: { id: number; productId: number; productCode: string; productName: string; baseUnit: string; qty: string; unitCost?: string }[] }

export async function listAdjustmentsIn(db: PrismaClient, actor: Actor, params: ListParams) {
  assertCan(actor.perms, "stock_adjust.manage"); const period = await getOpenPeriod(db), status = params.filters.status?.[0];
  const base = { type: "IN_NO_SUPPLIER" as const, periodId: period.id }, where = { ...base, ...(status === "active" ? { isCancelled: false } : status === "cancelled" ? { isCancelled: true } : {}) };
  const [rows, total, all, cancelled] = await Promise.all([db.stockAdjustment.findMany({ where, include: { _count: { select: { lines: true } } }, orderBy: [sortToOrderBy(params.sort, ["code", "at"], { at: "desc" }), { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize }), db.stockAdjustment.count({ where }), db.stockAdjustment.count({ where: base }), db.stockAdjustment.count({ where: { ...base, isCancelled: true } })]);
  const names = new Map((await db.user.findMany({ where: { id: { in: rows.map((row) => row.createdBy) } }, select: { id: true, fullName: true } })).map((user) => [user.id, user.fullName]));
  return { rows: rows.map((row) => ({ id: row.id, code: row.code, at: row.at, note: row.note, lineCount: row._count.lines, isCancelled: row.isCancelled, createdByName: names.get(row.createdBy) ?? null })), total, stats: { all, active: all - cancelled, cancelled } };
}

export async function getAdjustmentIn(db: PrismaClient, actor: Actor, id: number): Promise<AdjustmentDetailDTO> {
  assertCan(actor.perms, "stock_adjust.manage"); const row = await db.stockAdjustment.findUnique({ where: { id }, include: { lines: { include: { product: { select: { code: true, name: true, baseUnit: true } } }, orderBy: { id: "asc" } } } });
  if (!row || row.type !== "IN_NO_SUPPLIER") throw new DomainError("Không tìm thấy phiếu nhập kho.", 404);
  const creator = await db.user.findUnique({ where: { id: row.createdBy }, select: { fullName: true } });
  return redactDeep({ id: row.id, code: row.code, at: row.at, note: row.note, isCancelled: row.isCancelled, cancelReason: row.cancelReason, createdByName: creator?.fullName ?? null, lines: row.lines.map((line) => ({ id: line.id, productId: line.productId, productCode: line.product.code, productName: line.product.name, baseUnit: line.product.baseUnit, qty: line.qty.toString(), unitCost: line.unitCost.toString() })) }, actor.perms) as AdjustmentDetailDTO;
}
