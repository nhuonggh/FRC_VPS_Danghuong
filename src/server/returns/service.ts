import { Prisma, type PrismaClient, type StockDocType } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { ictYmd } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import { deliveredValue } from "@/server/delivery/service";
import { DomainError } from "@/server/http/errors";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import { docTimestamp, getOnHand, PeriodClosedError, postIssue, postReceipt, productsOfDocument, removeDocument, withInventoryTx, type EngineCtx } from "@/server/inventory";
import { convertToBase, resolveFactor } from "@/server/products/units";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import { lineAmountOf } from "@/server/sales/queries";
import { loadCustomer } from "@/server/sales/service";
import { resolveReturnCostByProduct } from "./pricing";
import type { ReturnByOrderInput, ReturnByProductInput } from "./schemas";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const sortedUnique = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);

export type ReturnMode = "BY_PRODUCT" | "SUPPLIER";
const stockDocOf = (kind: "BY_ORDER" | "BY_PRODUCT" | "SUPPLIER"): StockDocType => (kind === "SUPPLIER" ? "RETURN_SUPPLIER" : "RETURN_IN");

function assertWriter(actor: Actor, kind: "BY_ORDER" | "BY_PRODUCT" | "SUPPLIER") {
  assertCan(actor.perms, "return.manage");
  if (kind === "BY_PRODUCT") assertCan(actor.perms, "sale_price.view"); // người nhập giá trừ công nợ phải thấy giá bán
  if (kind === "SUPPLIER") assertCan(actor.perms, "purchase_price.view"); // giá thỏa thuận với NCC là giá nhập
}

const qtyReturned = (l: { returnLines: { qty: Prisma.Decimal }[] }) => l.returnLines.reduce((s, r) => s.plus(r.qty), D(0));
const qtyDelivered = (l: { deliveryLines: { qty: Prisma.Decimal }[] }) => l.deliveryLines.reduce((s, d) => s.plus(d.qty), D(0));

/** Khoá đơn (tuần tự hoá với giao/sửa/hủy/trả cùng đơn) và nạp lượng đã giao / đã trả còn hiệu lực theo dòng. */
async function lockOrderForReturn(tx: Tx, actor: Actor, orderId: number) {
  await tx.$queryRaw`SELECT id FROM sale_orders WHERE id = ${orderId} FOR UPDATE`;
  const order = await tx.saleOrder.findFirst({
    where: { id: orderId, partner: partnerScopeWhere(actor) },
    include: {
      lines: {
        orderBy: { id: "asc" },
        include: {
          deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } },
          returnLines: { where: { goodsReturn: { isCancelled: false } }, select: { qty: true } },
        },
      },
    },
  });
  if (!order) throw new DomainError("Không tìm thấy đơn hàng.", 404);
  return order;
}

async function nextCode(tx: Tx, kind: "BY_ORDER" | "BY_PRODUCT" | "SUPPLIER") {
  const id = await nextDocId(tx, "goods_returns");
  return { id, code: formatDocCode(kind === "SUPPLIER" ? "TN" : "TH", id) };
}

// ───────────────────────────── TRẢ THEO ĐƠN (43) ─────────────────────────────
/**
 * Hàng nhập lại theo GIÁ VỐN của dòng bán gốc (`costRef`: đổi khi vốn dòng gốc đổi). Tiền trừ công nợ = thành tiền dòng
 * (sau chiết khấu trừ ngay) theo tỷ lệ SL, làm tròn luỹ kế; chiết khấu tích lũy đảo cùng tỷ lệ. Không trả quá SL ĐÃ GIAO
 * (D-30). Trả hàng không bù đơn treo cũ (giả định 1 §8 — engine lo). Dòng gia công (tôn xốp/BOM) không trả theo đơn.
 */
export async function createReturnByOrder(ctx: EngineCtx, actor: Actor, input: ReturnByOrderInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertWriter(actor, "BY_ORDER");
  const tx = ctx.tx;
  const order = await lockOrderForReturn(tx, actor, input.orderId);
  if (order.isCancelled || order.isDraft) throw new DomainError("Đơn đã hủy hoặc còn là nháp, không trả hàng được.", 409);
  const at = docTimestamp(input.date, now);
  if (ictYmd(at) < ictYmd(order.orderDate)) throw new DomainError("Ngày trả không được trước ngày đơn.", 400);

  const byId = new Map(order.lines.map((l) => [l.id, l]));
  const seen = new Set<number>();
  let total = D(0);
  const rows = input.lines.map((l, i) => {
    const line = byId.get(l.orderLineId);
    if (!line) throw new DomainError(`Dòng ${i + 1}: không thuộc đơn này.`, 400);
    if (seen.has(line.id)) throw new DomainError(`Dòng ${i + 1}: bị trùng.`, 400);
    seen.add(line.id);
    if (line.processingTypeId !== null) throw new DomainError(`Dòng ${i + 1}: hàng gia công theo định mức không trả theo đơn được.`, 400);
    if (!ctx.locked.has(line.productId)) throw new DomainError("Đơn vừa được người khác sửa, hãy tải lại trang rồi thử lại.", 409);
    const delivered = qtyDelivered(line);
    const returned = qtyReturned(line);
    const remaining = delivered.minus(returned);
    if (D(l.qty).gt(remaining)) throw new DomainError(`Dòng ${i + 1}: chỉ còn ${remaining.toString()} ${line.unit} có thể trả (đã giao ${delivered.toString()}, đã trả ${returned.toString()}).`, 400);
    const qty = D(l.qty);
    const amount = deliveredValue(lineAmountOf(line), line.qty, returned, qty);
    const discount = deliveredValue(line.discountAccum, line.qty, returned, qty);
    total = total.plus(amount);
    return { line, qty, qtyBase: convertToBase(qty, line.factorUsed), amount, discount };
  });

  const { id, code } = await nextCode(tx, "BY_ORDER");
  await tx.goodsReturn.create({
    data: { id, code, periodId: ctx.period.id, kind: "BY_ORDER", partnerId: order.partnerId, orderId: order.id, at, note: input.note || null, totalAmount: total, createdBy: actor.userId },
  });
  for (const r of rows) {
    const row = await tx.goodsReturnLine.create({
      data: {
        returnId: id, productId: r.line.productId, orderLineId: r.line.id, qty: r.qty, unit: r.line.unit, factorUsed: r.line.factorUsed, qtyBase: r.qtyBase,
        unitPrice: round2(r.amount.div(r.qty)), amount: r.amount, discountAccumReversed: r.discount, at,
      },
    });
    const { seq } = await postReceipt(ctx, {
      productId: r.line.productId, qty: r.qtyBase, unitCost: r.line.unitCostFifo, docType: "RETURN_IN", docId: id, docLineId: row.id, at,
      costRef: { docType: "SALE", docLineId: r.line.id, qty: r.line.qtyBase },
    });
    await tx.goodsReturnLine.update({ where: { id: row.id }, data: { seq } });
    if (r.discount.gt(0)) {
      await tx.discountLedger.create({ data: { periodId: ctx.period.id, partnerId: order.partnerId, orderLineId: r.line.id, amountOut: r.discount, docType: "RETURN", docId: id, at, createdBy: actor.userId } });
    }
  }
  if (total.gt(0)) await tx.partnerLedger.create({ data: { periodId: ctx.period.id, partnerId: order.partnerId, credit: total, docType: "RETURN", docId: id, at, createdBy: actor.userId } });
  await writeAudit(tx, { userId: actor.userId, action: "return.create", entity: "GoodsReturn", entityId: id, after: { code, kind: "BY_ORDER", orderCode: order.code, lineCount: rows.length } });
  return { id, code };
}

// ─────────────────── TRẢ THEO SẢN PHẨM (45) VÀ TRẢ NCC (47) ───────────────────
export async function createReturnByProduct(ctx: EngineCtx, actor: Actor, mode: ReturnMode, input: ReturnByProductInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertWriter(actor, mode);
  const tx = ctx.tx;
  const partner = mode === "SUPPLIER"
    ? await tx.partner.findFirst({ where: { id: input.partnerId, isSupplier: true, isActive: true, mergedIntoId: null }, select: { id: true, code: true } })
    : await loadCustomer(tx, actor, input.partnerId);
  if (!partner) throw new DomainError("Không tìm thấy nhà cung cấp.", 404);
  const at = docTimestamp(input.date, now);

  const products = await tx.product.findMany({ where: { id: { in: sortedUnique(input.lines.map((l) => l.productId)) } }, include: { units: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const need = new Map<number, Prisma.Decimal>(); // tổng SL gốc trả NCC theo mã (kiểm tồn)
  let total = D(0);
  const rows = [] as { productId: number; unit: string; qty: Prisma.Decimal; factor: Prisma.Decimal; qtyBase: Prisma.Decimal; unitPrice: Prisma.Decimal; amount: Prisma.Decimal; cost: Prisma.Decimal }[];
  for (const [i, l] of input.lines.entries()) {
    const product = byId.get(l.productId);
    if (!product) throw new DomainError(`Dòng ${i + 1}: sản phẩm không tồn tại.`, 400);
    if (!ctx.locked.has(product.id)) throw new DomainError("Dữ liệu vừa thay đổi, hãy tải lại trang rồi thử lại.", 409);
    const factor = resolveFactor(product, l.unit);
    const qtyBase = convertToBase(l.qty, factor);
    if (!qtyBase.gt(0)) throw new DomainError(`Dòng ${i + 1}: số lượng quá nhỏ (quy đổi ra ${product.baseUnit} bằng 0).`, 400);
    const amount = round2(D(l.qty).times(l.unitPrice));
    total = total.plus(amount);
    need.set(product.id, (need.get(product.id) ?? D(0)).plus(qtyBase));
    const cost = mode === "BY_PRODUCT" ? await resolveReturnCostByProduct(tx, partner.id, product.id, product.code) : D(0);
    rows.push({ productId: product.id, unit: l.unit, qty: D(l.qty), factor, qtyBase, unitPrice: D(l.unitPrice), amount, cost });
  }
  if (mode === "SUPPLIER") {
    for (const [productId, qty] of need) {
      const onHand = await getOnHand(tx, ctx.period.id, productId);
      if (onHand.lt(qty)) throw new DomainError(`${byId.get(productId)!.code}: tồn ${onHand.toString()} ${byId.get(productId)!.baseUnit}, không đủ để trả ${qty.toString()}.`, 400);
    }
  }

  const { id, code } = await nextCode(tx, mode);
  await tx.goodsReturn.create({ data: { id, code, periodId: ctx.period.id, kind: mode, partnerId: partner.id, at, note: input.note || null, totalAmount: total, createdBy: actor.userId } });
  for (const r of rows) {
    const row = await tx.goodsReturnLine.create({
      data: { returnId: id, productId: r.productId, qty: r.qty, unit: r.unit, factorUsed: r.factor, qtyBase: r.qtyBase, unitPrice: r.unitPrice, amount: r.amount, at },
    });
    const { seq } = mode === "SUPPLIER"
      ? await postIssue(ctx, { productId: r.productId, qty: r.qtyBase, docType: "RETURN_SUPPLIER", docId: id, docLineId: row.id, at })
      : await postReceipt(ctx, { productId: r.productId, qty: r.qtyBase, unitCost: r.cost, docType: "RETURN_IN", docId: id, docLineId: row.id, at });
    await tx.goodsReturnLine.update({ where: { id: row.id }, data: { seq } });
  }
  if (total.gt(0)) {
    // Khách trả → khách nợ ít đi (credit). Trả NCC → mình nợ NCC ít đi (debit; mua hàng là credit).
    await tx.partnerLedger.create({
      data: { periodId: ctx.period.id, partnerId: partner.id, ...(mode === "SUPPLIER" ? { debit: total } : { credit: total }), docType: "RETURN", docId: id, at, createdBy: actor.userId },
    });
  }
  await writeAudit(tx, { userId: actor.userId, action: "return.create", entity: "GoodsReturn", entityId: id, after: { code, kind: mode, partnerCode: partner.code, lineCount: rows.length } });
  return { id, code };
}

// ───────────────────────────── ĐƯỜNG VÀO (transaction kho) ─────────────────────────────
export async function createReturnByOrderIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: ReturnByOrderInput, now: Date = new Date()) {
  assertWriter(actor, "BY_ORDER");
  const lines = await prisma.saleOrderLine.findMany({ where: { orderId: input.orderId, id: { in: input.lines.map((l) => l.orderLineId) } }, select: { productId: true } });
  return withIdempotentInventoryTx(prisma, { userId: actor.userId, products: sortedUnique(lines.map((l) => l.productId)), scope: "return.create", key }, (ctx) => createReturnByOrder(ctx, actor, input, now));
}

export async function createReturnByProductIdempotent(prisma: PrismaClient, actor: Actor, mode: ReturnMode, key: string, input: ReturnByProductInput, now: Date = new Date()) {
  assertWriter(actor, mode);
  return withIdempotentInventoryTx(prisma, { userId: actor.userId, products: sortedUnique(input.lines.map((l) => l.productId)), scope: "return.create", key }, (ctx) => createReturnByProduct(ctx, actor, mode, input, now));
}

// ───────────────────────────── HỦY PHIẾU TRẢ ─────────────────────────────
/** Hủy: gỡ dòng kho, gỡ công nợ, đảo chiết khấu tích lũy bằng dòng điều chỉnh (không xoá lịch sử). Sửa = hủy + lập lại. */
export async function cancelReturn(ctx: EngineCtx, actor: Actor, id: number, reason: string, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "return.manage");
  const tx = ctx.tx;
  const head = await tx.goodsReturn.findUnique({ where: { id }, select: { orderId: true } });
  if (!head) throw new DomainError("Không tìm thấy phiếu trả hàng.", 404);
  if (head.orderId !== null) await tx.$queryRaw`SELECT id FROM sale_orders WHERE id = ${head.orderId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM goods_returns WHERE id = ${id} FOR UPDATE`;
  const ret = await tx.goodsReturn.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  if (ret.isCancelled) throw new DomainError("Phiếu trả hàng đã hủy trước đó.", 409);
  if (ret.periodId !== ctx.period.id) throw new PeriodClosedError();
  for (const l of ret.lines) if (!ctx.locked.has(l.productId)) throw new DomainError("Dữ liệu vừa thay đổi, hãy tải lại trang rồi thử lại.", 409);

  await removeDocument(ctx, stockDocOf(ret.kind), id);
  await tx.partnerLedger.deleteMany({ where: { docType: "RETURN", docId: id } });
  for (const l of ret.lines) {
    if (l.discountAccumReversed.gt(0) && l.orderLineId !== null) {
      await tx.discountLedger.create({ data: { periodId: ctx.period.id, partnerId: ret.partnerId, orderLineId: l.orderLineId, amountIn: l.discountAccumReversed, docType: "RETURN_CANCEL", docId: id, at: now, createdBy: actor.userId } });
    }
  }
  await tx.goodsReturn.update({ where: { id }, data: { isCancelled: true, cancelledAt: now, cancelledBy: actor.userId, cancelReason: reason } });
  await writeAudit(tx, { userId: actor.userId, action: "return.cancel", entity: "GoodsReturn", entityId: id, before: { code: ret.code }, after: { isCancelled: true, reason } });
}

export async function cancelReturnTx(prisma: PrismaClient, actor: Actor, id: number, reason: string) {
  assertCan(actor.perms, "return.manage");
  const ret = await prisma.goodsReturn.findUnique({ where: { id }, select: { periodId: true, kind: true } });
  if (!ret) throw new DomainError("Không tìm thấy phiếu trả hàng.", 404);
  const products = await productsOfDocument(prisma, stockDocOf(ret.kind), id);
  return withInventoryTx(prisma, { userId: actor.userId, periodId: ret.periodId, products }, (ctx) => cancelReturn(ctx, actor, id, reason));
}
