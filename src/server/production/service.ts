import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import { docTimestamp, getOnHand, PeriodClosedError, postIssue, postReceipt, productsOfDocument, removeDocument, withInventoryTx, type EngineCtx } from "@/server/inventory";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import type { ProductionOrderInput } from "./schemas";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const uniqueSorted = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);
const MATERIAL_KINDS = ["NVL", "HANG"] as const;

/** Mọi mã chạm bởi lệnh: thành phẩm + từng NVL (khoá theo thứ tự tăng dần trong withInventoryTx). */
export const productionProducts = (input: ProductionOrderInput) => uniqueSorted([input.productId, ...input.materials.map((m) => m.productId)]);

/**
 * Lệnh SX phụ kiện (spec 3.6, engine-fifo §PRODUCTION): NVL xuất `PRODUCTION_USE` (FIFO của chính NVL) GHI TRƯỚC,
 * rồi thành phẩm nhập `PRODUCTION_OUT` với `costRef` = lệnh. Giá thành phẩm = Σ vốn NVL / SL, do engine giữ.
 * `docLineId` của mọi dòng NVL và của costRef là id lệnh (duy nhất trong docType xuất PRODUCTION_USE).
 */
export async function createProductionOrder(ctx: EngineCtx, actor: Actor, input: ProductionOrderInput, now = new Date()) {
  assertCan(actor.perms, "production.manage");
  const ids = productionProducts(input);
  const products = await ctx.tx.product.findMany({ where: { id: { in: ids } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const target = byId.get(input.productId);
  if (!target) throw new DomainError("Phụ kiện không tồn tại.", 400);
  if (target.kind !== "PHU_KIEN") throw new DomainError(`${target.code} không phải phụ kiện — lệnh sản xuất chỉ dành cho phụ kiện (tôn xốp/1 lớp/sóng bán theo định mức, không lập lệnh).`, 400);
  if (!target.isActive) throw new DomainError(`${target.code} đã ngừng bán.`, 400);
  const seen = new Set<number>();
  for (const [i, m] of input.materials.entries()) {
    const p = byId.get(m.productId);
    if (!p) throw new DomainError(`Dòng NVL ${i + 1}: sản phẩm không tồn tại.`, 400);
    if (m.productId === input.productId) throw new DomainError(`Dòng NVL ${i + 1}: nguyên vật liệu không được trùng với thành phẩm.`, 400);
    if (seen.has(m.productId)) throw new DomainError(`Dòng NVL ${i + 1}: ${p.code} bị lặp — gộp thành một dòng.`, 400);
    seen.add(m.productId);
    if (!(MATERIAL_KINDS as readonly string[]).includes(p.kind)) throw new DomainError(`Dòng NVL ${i + 1}: ${p.code} không phải nguyên vật liệu/hàng hóa.`, 400);
    const onHand = await getOnHand(ctx.tx, ctx.period.id, p.id);
    if (onHand.lt(D(m.qty))) throw new DomainError(`Không đủ tồn ${p.code}: cần ${m.qty}, còn ${onHand.toString()} ${p.baseUnit}.`, 409);
  }
  const id = await nextDocId(ctx.tx, "production_orders"), code = formatDocCode("SX", id), at = docTimestamp(input.date, now);
  await ctx.tx.productionOrder.create({ data: { id, code, periodId: ctx.period.id, productId: input.productId, qty: D(input.qty), at, note: input.note || null, createdBy: actor.userId } });
  for (const m of input.materials) {
    const row = await ctx.tx.productionMaterial.create({ data: { orderId: id, materialProductId: m.productId, qty: D(m.qty) } });
    const { seq } = await postIssue(ctx, { productId: m.productId, qty: m.qty, docType: "PRODUCTION_USE", docId: id, docLineId: id, at });
    await ctx.tx.productionMaterial.update({ where: { id: row.id }, data: { seq } });
  }
  const out = await postReceipt(ctx, { productId: input.productId, qty: input.qty, unitCost: 0, docType: "PRODUCTION_OUT", docId: id, docLineId: id, at, costRef: { docType: "PRODUCTION_USE", docLineId: id, qty: input.qty } });
  await ctx.tx.productionOrder.update({ where: { id }, data: { outSeq: out.seq } });
  await writeAudit(ctx.tx, { userId: actor.userId, action: "production.create", entity: "ProductionOrder", entityId: id, after: { code, productCode: target.code, materialCount: input.materials.length } });
  return { id, code };
}

export async function createProductionOrderIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: ProductionOrderInput) {
  assertCan(actor.perms, "production.manage");
  return withIdempotentInventoryTx(prisma, { userId: actor.userId, products: productionProducts(input), scope: "production_order.create", key }, (ctx) => createProductionOrder(ctx, actor, input));
}

export async function cancelProductionOrder(ctx: EngineCtx, actor: Actor, id: number, reason: string) {
  assertCan(actor.perms, "production.manage");
  await ctx.tx.$queryRaw`SELECT id FROM production_orders WHERE id = ${id} FOR UPDATE`;
  const current = await ctx.tx.productionOrder.findUnique({ where: { id } });
  if (!current) throw new DomainError("Không tìm thấy lệnh sản xuất.", 404);
  if (current.isCancelled) throw new DomainError("Lệnh đã hủy trước đó.", 409);
  if (current.periodId !== ctx.period.id) throw new PeriodClosedError();
  // Thành phẩm (lớp phụ thuộc) gỡ trước, rồi NVL. Thành phẩm đã bán/dùng hết ⇒ engine từ chối (DependentDocumentsError).
  await removeDocument(ctx, "PRODUCTION_OUT", id);
  await removeDocument(ctx, "PRODUCTION_USE", id);
  await ctx.tx.productionOrder.update({ where: { id }, data: { isCancelled: true, cancelledAt: new Date(), cancelledBy: actor.userId, cancelReason: reason } });
  await writeAudit(ctx.tx, { userId: actor.userId, action: "production.cancel", entity: "ProductionOrder", entityId: id, before: { code: current.code }, after: { isCancelled: true, reason } });
}

export async function cancelProductionOrderTx(prisma: PrismaClient, actor: Actor, id: number, reason: string) {
  const pre = await prisma.productionOrder.findUnique({ where: { id }, select: { periodId: true, productId: true } });
  if (!pre) throw new DomainError("Không tìm thấy lệnh sản xuất.", 404);
  const products = uniqueSorted([pre.productId, ...(await productsOfDocument(prisma, "PRODUCTION_USE", id)), ...(await productsOfDocument(prisma, "PRODUCTION_OUT", id))]);
  return withInventoryTx(prisma, { userId: actor.userId, periodId: pre.periodId, products }, (ctx) => cancelProductionOrder(ctx, actor, id, reason));
}
