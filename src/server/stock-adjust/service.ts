import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { listTimeRange, sortToOrderBy, type ListParams } from "@/lib/query-params";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import { docTimestamp, getOnHand, PeriodClosedError, postIssue, productsOfDocument, removeDocument, withInventoryTx, type EngineCtx } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import { LOSS_TYPE_LABEL, type LossAdjustInput } from "./schemas";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const uniqueSorted = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);
const OUT_DOC = { LOSS: "ADJ_LOSS", WRITE_OFF: "WRITE_OFF" } as const;
const PREFIX = { LOSS: "HH", WRITE_OFF: "XH" } as const;

/** Điều chỉnh hao hụt (cắt lỗi) / xuất hủy (mục 28): xuất kho FIFO, không sinh công nợ; giá vốn do engine tính. Không cho xuất quá tồn. */
export async function createLossAdjust(ctx: EngineCtx, actor: Actor, input: LossAdjustInput, now = new Date()) {
  assertCan(actor.perms, "stock_adjust.manage");
  const ids = input.lines.map((l) => l.productId);
  if (new Set(ids).size !== ids.length) throw new DomainError("Mỗi sản phẩm chỉ xuất hiện một dòng.", 400);
  const products = await ctx.tx.product.findMany({ where: { id: { in: ids } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const [i, l] of input.lines.entries()) {
    const p = byId.get(l.productId);
    if (!p) throw new DomainError(`Dòng ${i + 1}: sản phẩm không tồn tại.`, 400);
    const onHand = await getOnHand(ctx.tx, ctx.period.id, p.id);
    if (onHand.lt(D(l.qty))) throw new DomainError(`Không đủ tồn ${p.code}: cần ${l.qty}, còn ${onHand.toString()} ${p.baseUnit}.`, 409);
  }
  const id = await nextDocId(ctx.tx, "stock_adjustments"), code = formatDocCode(PREFIX[input.type], id), at = docTimestamp(input.date, now);
  await ctx.tx.stockAdjustment.create({ data: { id, code, periodId: ctx.period.id, type: input.type, at, note: input.note, createdBy: actor.userId } });
  for (const l of input.lines) {
    // unitCost = 0: phiếu xuất không có giá nhập; giá vốn thật nằm ở cost_consumptions (đọc qua getLossAdjust).
    const row = await ctx.tx.stockAdjustmentLine.create({ data: { adjustmentId: id, productId: l.productId, qty: D(l.qty), unitCost: D(0) } });
    const { seq } = await postIssue(ctx, { productId: l.productId, qty: l.qty, docType: OUT_DOC[input.type], docId: id, docLineId: row.id, at });
    await ctx.tx.stockAdjustmentLine.update({ where: { id: row.id }, data: { seq } });
  }
  await writeAudit(ctx.tx, { userId: actor.userId, action: "stock_adjustment.create", entity: "StockAdjustment", entityId: id, after: { code, type: input.type, lineCount: input.lines.length } });
  return { id, code };
}

export async function createLossAdjustIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: LossAdjustInput) {
  assertCan(actor.perms, "stock_adjust.manage");
  return withIdempotentInventoryTx(prisma, { userId: actor.userId, products: uniqueSorted(input.lines.map((l) => l.productId)), scope: "loss_adjust.create", key }, (ctx) => createLossAdjust(ctx, actor, input));
}

export async function cancelLossAdjust(prisma: PrismaClient, actor: Actor, id: number, reason: string) {
  assertCan(actor.perms, "stock_adjust.manage");
  const pre = await prisma.stockAdjustment.findUnique({ where: { id }, select: { periodId: true, type: true } });
  if (!pre || (pre.type !== "LOSS" && pre.type !== "WRITE_OFF")) throw new DomainError("Không tìm thấy phiếu điều chỉnh.", 404);
  const docType = OUT_DOC[pre.type];
  return withInventoryTx(prisma, { userId: actor.userId, periodId: pre.periodId, products: await productsOfDocument(prisma, docType, id) }, async (ctx) => {
    await ctx.tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${id} FOR UPDATE`;
    const cur = await ctx.tx.stockAdjustment.findUniqueOrThrow({ where: { id } });
    if (cur.isCancelled) throw new DomainError("Phiếu đã hủy trước đó.", 409);
    if (cur.periodId !== ctx.period.id) throw new PeriodClosedError();
    await removeDocument(ctx, docType, id);
    await ctx.tx.stockAdjustment.update({ where: { id }, data: { isCancelled: true, cancelledAt: new Date(), cancelledBy: actor.userId, cancelReason: reason } });
    await writeAudit(ctx.tx, { userId: actor.userId, action: "stock_adjustment.cancel", entity: "StockAdjustment", entityId: id, before: { code: cur.code }, after: { isCancelled: true, reason } });
  });
}

export interface LossRowDTO { id: number; code: string; type: keyof typeof LOSS_TYPE_LABEL; at: Date; note: string | null; lineCount: number; isCancelled: boolean; createdByName: string | null }
export interface LossDetailDTO extends Omit<LossRowDTO, "lineCount"> { cancelReason: string | null; lines: { id: number; productCode: string; productName: string; baseUnit: string; qty: string; /** chỉ cost.view */ cost?: string | null }[] }
const TYPES = ["LOSS", "WRITE_OFF"] as const;

export async function listLossAdjusts(db: PrismaClient, actor: Actor, params: ListParams) {
  assertCan(actor.perms, "stock_adjust.manage");
  const period = await getOpenPeriod(db), status = params.filters.status?.[0], type = params.filters.type?.[0];
  const range = listTimeRange(params);
  const base = { periodId: period.id, type: { in: [...TYPES] }, ...(range ? { at: { gte: range.start, lt: range.end } } : {}) };
  const typeFilter: "LOSS" | "WRITE_OFF" | undefined = type === "LOSS" ? "LOSS" : type === "WRITE_OFF" ? "WRITE_OFF" : undefined;
  const where: Prisma.StockAdjustmentWhereInput = { ...base, ...(typeFilter ? { type: typeFilter } : {}), ...(status === "active" ? { isCancelled: false } : status === "cancelled" ? { isCancelled: true } : {}) };
  const [rows, total, all, cancelled] = await Promise.all([
    db.stockAdjustment.findMany({ where, include: { _count: { select: { lines: true } } }, orderBy: [sortToOrderBy(params.sort, ["code", "at"], { at: "desc" }), { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
    db.stockAdjustment.count({ where }), db.stockAdjustment.count({ where: base }), db.stockAdjustment.count({ where: { ...base, isCancelled: true } }),
  ]);
  const names = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.createdBy) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return { rows: rows.map((r): LossRowDTO => ({ id: r.id, code: r.code, type: r.type as "LOSS" | "WRITE_OFF", at: r.at, note: r.note, lineCount: r._count.lines, isCancelled: r.isCancelled, createdByName: names.get(r.createdBy) ?? null })), total, stats: { all, active: all - cancelled, cancelled } };
}

export async function getLossAdjust(db: PrismaClient, actor: Actor, id: number): Promise<LossDetailDTO> {
  assertCan(actor.perms, "stock_adjust.manage");
  const row = await db.stockAdjustment.findUnique({ where: { id }, include: { lines: { orderBy: { id: "asc" }, include: { product: { select: { code: true, name: true, baseUnit: true } } } } } });
  if (!row || (row.type !== "LOSS" && row.type !== "WRITE_OFF")) throw new DomainError("Không tìm thấy phiếu điều chỉnh.", 404);
  const creator = await db.user.findUnique({ where: { id: row.createdBy }, select: { fullName: true } });
  const dto: LossDetailDTO = { id: row.id, code: row.code, type: row.type, at: row.at, note: row.note, isCancelled: row.isCancelled, cancelReason: row.cancelReason, createdByName: creator?.fullName ?? null, lines: row.lines.map((l) => ({ id: l.id, productCode: l.product.code, productName: l.product.name, baseUnit: l.product.baseUnit, qty: l.qty.toString() })) };
  if (actor.perms.has("cost.view") && !row.isCancelled) {
    const consumed = await db.costConsumption.findMany({ where: { docType: OUT_DOC[row.type], docLineId: { in: row.lines.map((l) => l.id) } }, select: { docLineId: true, qty: true, unitCost: true } });
    const byLine = new Map<number, number>();
    for (const c of consumed) byLine.set(c.docLineId, (byLine.get(c.docLineId) ?? 0) + Number(c.qty) * Number(c.unitCost));
    dto.lines = dto.lines.map((l) => ({ ...l, cost: byLine.has(l.id) ? String(Math.round(byLine.get(l.id)!)) : null }));
  }
  return dto;
}
