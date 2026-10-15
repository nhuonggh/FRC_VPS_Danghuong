import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { ictYmd } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import { docTimestamp, getOnHand, PeriodClosedError, postIssue, postReceipt, removeDocument, withInventoryTx, type EngineCtx } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import { lastPurchaseCost } from "@/server/purchase/last-cost";
import type { StocktakeInput } from "./schemas";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const uniqueSorted = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);

async function validateLines(db: Prisma.TransactionClient | PrismaClient, input: StocktakeInput) {
  const ids = input.lines.map((l) => l.productId);
  if (new Set(ids).size !== ids.length) throw new DomainError("Mỗi sản phẩm chỉ xuất hiện một dòng trong phiếu kiểm kho.", 400);
  const found = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, isActive: true } });
  if (found.length !== new Set(ids).size) throw new DomainError("Có sản phẩm không tồn tại.", 400);
  const off = found.find((p) => !p.isActive);
  if (off) throw new DomainError(`${off.code} đã ngừng bán — bỏ khỏi phiếu kiểm kho.`, 400);
}

/** Lập/ sửa nháp không đụng kho (không cần khoá kho): tồn sổ sách chỉ được chốt khi bấm Chốt. */
export async function createStocktake(db: PrismaClient, actor: Actor, input: StocktakeInput, now = new Date()) {
  assertCan(actor.perms, "stocktake.manage");
  await validateLines(db, input);
  const period = await getOpenPeriod(db);
  return db.$transaction(async (tx) => {
    const id = await nextDocId(tx, "stocktakes"), code = formatDocCode("KK", id);
    await tx.stocktake.create({ data: { id, code, periodId: period.id, at: docTimestamp(input.date, now), note: input.note || null, createdBy: actor.userId, lines: { create: input.lines.map((l) => ({ productId: l.productId, actualQty: D(l.actualQty) })) } } });
    await writeAudit(tx, { userId: actor.userId, action: "stocktake.create", entity: "Stocktake", entityId: id, after: { code, lineCount: input.lines.length } });
    return { id, code };
  });
}

export async function updateStocktake(db: PrismaClient, actor: Actor, id: number, input: StocktakeInput, now = new Date()) {
  assertCan(actor.perms, "stocktake.manage");
  await validateLines(db, input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM stocktakes WHERE id = ${id} FOR UPDATE`;
    const cur = await tx.stocktake.findUnique({ where: { id } });
    if (!cur) throw new DomainError("Không tìm thấy phiếu kiểm kho.", 404);
    if (cur.status !== "DRAFT") throw new DomainError("Chỉ sửa được phiếu nháp.", 409);
    await tx.stocktakeLine.deleteMany({ where: { stocktakeId: id } });
    await tx.stocktake.update({ where: { id }, data: { at: docTimestamp(input.date, now), note: input.note || null, lines: { create: input.lines.map((l) => ({ productId: l.productId, actualQty: D(l.actualQty) })) } } });
    await writeAudit(tx, { userId: actor.userId, action: "stocktake.update", entity: "Stocktake", entityId: id, after: { lineCount: input.lines.length } });
    return { id, code: cur.code };
  });
}

/**
 * Chốt phiếu: tồn sổ sách tại lúc chốt vs tồn thực đếm. Thừa ⇒ nhập `STOCKTAKE_IN` theo giá nhập mua gần nhất;
 * thiếu ⇒ xuất `STOCKTAKE_OUT` (FIFO). Bằng nhau ⇒ chỉ ghi nhận. `docLineId` = id dòng phiếu.
 */
export async function confirmStocktake(ctx: EngineCtx, actor: Actor, id: number, now = new Date()) {
  assertCan(actor.perms, "stocktake.manage");
  await ctx.tx.$queryRaw`SELECT id FROM stocktakes WHERE id = ${id} FOR UPDATE`;
  const st = await ctx.tx.stocktake.findUnique({ where: { id }, include: { lines: { orderBy: { id: "asc" }, include: { product: { select: { code: true } } } } } });
  if (!st) throw new DomainError("Không tìm thấy phiếu kiểm kho.", 404);
  if (st.status !== "DRAFT") throw new DomainError("Phiếu đã chốt hoặc đã hủy.", 409);
  if (st.periodId !== ctx.period.id) throw new PeriodClosedError();
  if (ictYmd(st.at) > ictYmd(now)) throw new DomainError("Chưa tới ngày kiểm kho.", 400);
  const at = st.at;
  let over = 0, short = 0;
  for (const line of st.lines) {
    const system = await getOnHand(ctx.tx, ctx.period.id, line.productId);
    const diff = line.actualQty.minus(system);
    let unitCost: Prisma.Decimal | null = null, seq: bigint | null = null;
    if (diff.gt(0)) {
      unitCost = await lastPurchaseCost(ctx.tx, line.productId);
      if (unitCost === null) throw new DomainError(`Chưa có giá nhập gần nhất của ${line.product.code} để ghi nhận hàng thừa — lập phiếu nhập mua hoặc “Nhập kho không NCC” (có giá) trước.`, 400);
      seq = (await postReceipt(ctx, { productId: line.productId, qty: diff, unitCost, docType: "STOCKTAKE_IN", docId: id, docLineId: line.id, at })).seq; over++;
    } else if (diff.lt(0)) {
      seq = (await postIssue(ctx, { productId: line.productId, qty: diff.neg(), docType: "STOCKTAKE_OUT", docId: id, docLineId: line.id, at })).seq; short++;
    }
    await ctx.tx.stocktakeLine.update({ where: { id: line.id }, data: { systemQty: system, diff, unitCost, seq } });
  }
  await ctx.tx.stocktake.update({ where: { id }, data: { status: "DONE", confirmedAt: now, confirmedBy: actor.userId } });
  await writeAudit(ctx.tx, { userId: actor.userId, action: "stocktake.confirm", entity: "Stocktake", entityId: id, after: { code: st.code, over, short, lineCount: st.lines.length } });
  return { id, code: st.code, over, short };
}

async function productsOf(prisma: PrismaClient, id: number) {
  const lines = await prisma.stocktakeLine.findMany({ where: { stocktakeId: id }, select: { productId: true } });
  return uniqueSorted(lines.map((l) => l.productId));
}

export async function confirmStocktakeIdempotent(prisma: PrismaClient, actor: Actor, key: string, id: number) {
  assertCan(actor.perms, "stocktake.manage");
  const pre = await prisma.stocktake.findUnique({ where: { id }, select: { id: true } });
  if (!pre) throw new DomainError("Không tìm thấy phiếu kiểm kho.", 404);
  return withIdempotentInventoryTx(prisma, { userId: actor.userId, products: await productsOf(prisma, id), scope: `stocktake.confirm:${id}`, key }, (ctx) => confirmStocktake(ctx, actor, id));
}

/** Hủy: nháp ⇒ đổi trạng thái; đã chốt ⇒ gỡ nhập/xuất chênh lệch (engine từ chối nếu hàng thừa đã bị dùng ở chứng từ phụ thuộc). */
export async function cancelStocktake(prisma: PrismaClient, actor: Actor, id: number, reason: string) {
  assertCan(actor.perms, "stocktake.manage");
  const pre = await prisma.stocktake.findUnique({ where: { id }, select: { periodId: true, status: true } });
  if (!pre) throw new DomainError("Không tìm thấy phiếu kiểm kho.", 404);
  if (pre.status === "CANCELLED") throw new DomainError("Phiếu đã hủy trước đó.", 409);
  const mark = (tx: Prisma.TransactionClient, code: string) => tx.stocktake.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: actor.userId, cancelReason: reason } }).then(() => writeAudit(tx, { userId: actor.userId, action: "stocktake.cancel", entity: "Stocktake", entityId: id, before: { code, status: pre.status }, after: { status: "CANCELLED", reason } }));
  if (pre.status === "DRAFT") {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stocktakes WHERE id = ${id} FOR UPDATE`;
      const cur = await tx.stocktake.findUniqueOrThrow({ where: { id } });
      if (cur.status !== "DRAFT") throw new DomainError("Trạng thái phiếu vừa thay đổi, hãy tải lại.", 409);
      await mark(tx, cur.code);
    });
  }
  return withInventoryTx(prisma, { userId: actor.userId, periodId: pre.periodId, products: await productsOf(prisma, id) }, async (ctx) => {
    await ctx.tx.$queryRaw`SELECT id FROM stocktakes WHERE id = ${id} FOR UPDATE`;
    const cur = await ctx.tx.stocktake.findUniqueOrThrow({ where: { id } });
    if (cur.status !== "DONE") throw new DomainError("Trạng thái phiếu vừa thay đổi, hãy tải lại.", 409);
    if (cur.periodId !== ctx.period.id) throw new PeriodClosedError();
    await removeDocument(ctx, "STOCKTAKE_IN", id);
    await removeDocument(ctx, "STOCKTAKE_OUT", id);
    await mark(ctx.tx, cur.code);
  });
}
