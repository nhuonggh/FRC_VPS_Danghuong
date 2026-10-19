import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import { docTimestamp, getOnHand, PeriodClosedError, postIssue, postReceipt, productsOfDocument, removeDocument, withInventoryTx, type EngineCtx } from "@/server/inventory";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import { productionOrderSchema, productionOutputs, type ProductionOrderInput } from "./schemas";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const uniqueSorted = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);


/** Mọi mã chạm bởi lệnh: thành phẩm + từng NVL (khoá theo thứ tự tăng dần trong withInventoryTx). */
export const productionProducts = (input: ProductionOrderInput) => uniqueSorted([...productionOutputs(input).map(o => o.productId), ...input.materials.map((m) => m.productId)]);

/**
 * Lệnh SX sản phẩm (engine-fifo §PRODUCTION): NVL xuất `PRODUCTION_USE` (FIFO của chính NVL) GHI TRƯỚC,
 * rồi từng thành phẩm nhập `PRODUCTION_OUT` với `costRef` = lệnh và tỷ lệ phân bổ riêng.
 * Giá thành phẩm = Σ vốn NVL × tỷ lệ / SL, engine tự lan truyền khi giá NVL thay đổi.
 * `docLineId` NVL/costRef là id lệnh; dòng nhập dùng id ProductionOutput.
 */
export async function createProductionOrder(ctx: EngineCtx, actor: Actor, input: ProductionOrderInput, now = new Date()) {
  assertCan(actor.perms, "production.manage");
  input = productionOrderSchema.parse(input);
  const outputs = productionOutputs(input), first = outputs[0];
  const outputIds = new Set(outputs.map(o => o.productId));
  const ids = productionProducts(input);
  const products = await ctx.tx.product.findMany({ where: { id: { in: ids } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const output of outputs) {
    const target = byId.get(output.productId);
    if (!target) throw new DomainError("Sản phẩm đầu ra không tồn tại.", 400);
    if (!target.canProduce) throw new DomainError(`${target.code} chưa bật khả năng được sản xuất.`, 400);
    if (!target.isActive) throw new DomainError(`${target.code} đã ngừng sử dụng.`, 400);
  }
  if (input.allocationBasis === "AREA") {
    // ASSUMPTION: xẻ dọc cùng vật liệu/độ dày; đơn vị gốc phải là mét dài, không suy diễn quy cách từ tên mã.
    for (const p of products) if (!["m", "md", "mét", "mét dài", "m dài"].includes(p.baseUnit.trim().toLowerCase())) throw new DomainError(`Xẻ khổ yêu cầu đơn vị mét dài: ${p.code}.`, 400);
  }
  const seen = new Set<number>();
  for (const [i, m] of input.materials.entries()) {
    const p = byId.get(m.productId);
    if (!p) throw new DomainError(`Dòng NVL ${i + 1}: sản phẩm không tồn tại.`, 400);
    if (outputIds.has(m.productId)) throw new DomainError(`Dòng NVL ${i + 1}: nguyên vật liệu không được trùng với thành phẩm.`, 400);
    if (seen.has(m.productId)) throw new DomainError(`Dòng NVL ${i + 1}: ${p.code} bị lặp — gộp thành một dòng.`, 400);
    seen.add(m.productId);
    if (!p.canUseAsMaterial) throw new DomainError(`Dòng NVL ${i + 1}: ${p.code} chưa bật khả năng dùng làm nguyên liệu.`, 400);
    if (!p.isActive) throw new DomainError(`Dòng NVL ${i + 1}: ${p.code} đã ngừng sử dụng.`, 400);
    const onHand = await getOnHand(ctx.tx, ctx.period.id, p.id);
    if (onHand.lt(D(m.qty))) throw new DomainError(`Không đủ tồn ${p.code}: cần ${m.qty}, còn ${onHand.toString()} ${p.baseUnit}.`, 409);
  }
  const id = await nextDocId(ctx.tx, "production_orders"), code = formatDocCode("SX", id), at = docTimestamp(input.date, now);
  await ctx.tx.productionOrder.create({ data: { id, code, periodId: ctx.period.id, productId: first.productId, qty: D(first.qty), allocationBasis: input.allocationBasis ?? "WEIGHT", at, note: input.note || null, createdBy: actor.userId } });
  for (const m of input.materials) {
    const row = await ctx.tx.productionMaterial.create({ data: { orderId: id, materialProductId: m.productId, qty: D(m.qty), widthMm: input.allocationBasis === "AREA" ? m.widthMm : null } });
    const { seq } = await postIssue(ctx, { productId: m.productId, qty: m.qty, docType: "PRODUCTION_USE", docId: id, docLineId: id, at });
    await ctx.tx.productionMaterial.update({ where: { id: row.id }, data: { seq } });
  }
  const weights = outputs.map(o => input.allocationBasis === "AREA" ? D(o.qty).times(o.widthMm!).div(1000).toDecimalPlaces(3) : D(o.allocationWeight ?? 1));
  if (weights.some(w => !w.gt(0))) throw new DomainError("Trọng số phân bổ quá nhỏ.", 400);
  const totalWeight = weights.reduce((s, w) => s.plus(w), D(0));
  let allocated = D(0);
  for (const [i, output] of outputs.entries()) {
    // Làm tròn tỷ lệ ở 12 số; đầu ra cuối nhận phần còn lại để tổng tỷ lệ đúng 1.
    const share = i === outputs.length - 1 ? D(1).minus(allocated) : weights[i].div(totalWeight).toDecimalPlaces(12);
    if (!share.gt(0)) throw new DomainError("Tỷ trọng phân bổ quá nhỏ; điều chỉnh trọng số đầu ra.", 400);
    allocated = allocated.plus(share);
    const row = await ctx.tx.productionOutput.create({ data: { orderId: id, productId: output.productId, qty: D(output.qty), widthMm: input.allocationBasis === "AREA" ? output.widthMm : null, stripCount: input.allocationBasis === "AREA" ? output.stripCount ?? 1 : 1, lengthM: input.allocationBasis === "AREA" ? output.lengthM : null, allocationWeight: weights[i] } });
    const out = await postReceipt(ctx, { productId: output.productId, qty: output.qty, unitCost: 0, docType: "PRODUCTION_OUT", docId: id, docLineId: row.id, at, costRef: { docType: "PRODUCTION_USE", docLineId: id, qty: output.qty, share } });
    await ctx.tx.productionOutput.update({ where: { id: row.id }, data: { seq: out.seq } });
    if (i === 0) await ctx.tx.productionOrder.update({ where: { id }, data: { outSeq: out.seq } });
  }
  await writeAudit(ctx.tx, { userId: actor.userId, action: "production.create", entity: "ProductionOrder", entityId: id, after: { code, outputCount: outputs.length, allocationBasis: input.allocationBasis ?? "WEIGHT", materialCount: input.materials.length } });
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
  // The inventory engine may replay ordinary receipt removal into negative stock.
  // A production output already consumed must instead keep its provenance intact.
  const consumed = await ctx.tx.costConsumption.count({
    where: { layer: { sourceDocType: "PRODUCTION_OUT", sourceDocId: id } },
  });
  if (consumed > 0) throw new DomainError("Không hủy được: sản phẩm đầu ra đã được bán hoặc sử dụng. Hãy xử lý chứng từ tiêu thụ trước.", 409, "PRODUCTION_OUTPUT_CONSUMED");
  // Gỡ đầu ra trước, rồi hoàn nguyên liệu trong cùng giao dịch.
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
