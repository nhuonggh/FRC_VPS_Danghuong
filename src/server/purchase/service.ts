import { lockIdsOf, stockProductIdsOf } from "@/server/stock-lanes";
import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { normalizeSearch } from "@/lib/search";
import { toIct } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import {
  docTimestamp, PeriodClosedError, postReceipt, productsOfDocument, removeDocument, unitCostOf, updateLayerCost, withInventoryTx,
  type EngineCtx,
} from "@/server/inventory";
import { convertToBase, resolveFactor } from "@/server/products/units";
import { formatDocCode, nextDocId } from "./codes";
import { allocateFreight, FREIGHT_IN_COST } from "./freight";
import type { PurchaseInput } from "./schemas";
import { createPayment } from "@/server/cash/vouchers";
import { postPartnerLedger, removePartnerLedger } from "@/server/debt/ledger";

type Tx = Prisma.TransactionClient;
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const round2 = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.plus(value), D(0));
const sortedUnique = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);
const ymd = (date: Date) => {
  const time = toIct(date);
  return `${time.y}-${String(time.m + 1).padStart(2, "0")}-${String(time.d).padStart(2, "0")}`;
};

function assertWriter(actor: Actor, permission: "purchase.create" | "purchase.edit") {
  assertCan(actor.perms, permission);
  assertCan(actor.perms, "purchase_price.view");
}

async function ensureSupplier(tx: Tx, partnerId: number, alreadyOn?: number) {
  const partner = await tx.partner.findUnique({
    where: { id: partnerId },
    select: { isSupplier: true, isActive: true, mergedIntoId: true },
  });
  if (!partner || !partner.isSupplier || partner.mergedIntoId !== null) {
    throw new DomainError("Nhà cung cấp không hợp lệ.", 400);
  }
  if (!partner.isActive && partnerId !== alreadyOn) {
    throw new DomainError("Nhà cung cấp đã tắt, hãy chọn nhà cung cấp khác.", 400);
  }
}

interface PreparedLine {
  id?: number;
  productId: number;
  /** Mã kho thực sự nhập (kho con theo kiểu gia công; mặc định = productId). */
  stockProductId: number;
  qty: Prisma.Decimal;
  unit: string;
  factor: Prisma.Decimal;
  qtyBase: Prisma.Decimal;
  purchasePrice: Prisma.Decimal;
  purchaseAmount: Prisma.Decimal;
  rollInfo: string | null;
  processingTypeId: number | null;
}
interface CostedLine extends PreparedLine {
  allocatedFreight: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}

async function prepareLines(tx: Tx, lines: PurchaseInput["lines"], keepInactive: Set<number>): Promise<PreparedLine[]> {
  const stockIds = await stockProductIdsOf(tx, lines.map((line) => ({ productId: line.productId, processingTypeId: line.processingTypeId })));
  const products = await tx.product.findMany({
    where: { id: { in: sortedUnique(lines.map((line) => line.productId)) } },
    include: { units: true },
  });
  const productsById = new Map(products.map((product) => [product.id, product]));
  const typeIds = sortedUnique(lines.flatMap((line) => (line.processingTypeId ? [line.processingTypeId] : [])));
  const types = new Set((await tx.processingType.findMany({ where: { id: { in: typeIds } }, select: { id: true } })).map((t) => t.id));
  return lines.map((line, index) => {
    if (line.processingTypeId && !types.has(line.processingTypeId)) throw new DomainError(`Dòng ${index + 1}: kiểu gia công không tồn tại.`, 400);
    const product = productsById.get(line.productId);
    if (!product) throw new DomainError(`Dòng ${index + 1}: sản phẩm không tồn tại.`, 400);
    if (!product.isActive && !keepInactive.has(product.id)) {
      throw new DomainError(`Dòng ${index + 1}: sản phẩm ${product.code} đã ngừng bán.`, 400);
    }
    if (!product.canPurchase && !keepInactive.has(product.id)) throw new DomainError(`Dòng ${index + 1}: ${product.code} chưa bật khả năng được mua.`, 400);
    resolveFactor(product, line.unit);
    if (line.unit === product.baseUnit && !D(line.factor).eq(1)) {
      throw new DomainError(`Dòng ${index + 1}: đơn vị gốc (${product.baseUnit}) phải có hệ số 1.`, 400);
    }
    const qty = D(line.qty);
    const qtyBase = convertToBase(qty, line.factor);
    if (!qtyBase.gt(0)) {
      throw new DomainError(`Dòng ${index + 1}: số lượng quá nhỏ (quy đổi ra ${product.baseUnit} bằng 0).`, 400);
    }
    return {
      ...(line.id === undefined ? {} : { id: line.id }),
      productId: product.id,
      stockProductId: stockIds[index]!,
      qty,
      unit: line.unit,
      factor: D(line.factor),
      qtyBase,
      purchasePrice: D(line.purchasePrice),
      purchaseAmount: round2(qty.times(line.purchasePrice)),
      rollInfo: line.rollInfo || null,
      processingTypeId: line.processingTypeId ?? null,
    };
  });
}

function costLines(lines: PreparedLine[], freight: Prisma.Decimal): CostedLine[] {
  const allocated = FREIGHT_IN_COST
    ? allocateFreight(lines.map((line) => line.purchaseAmount), freight)
    : lines.map(() => D(0));
  return lines.map((line, index) => ({
    ...line,
    allocatedFreight: allocated[index]!,
    unitCost: unitCostOf(line.purchaseAmount.plus(allocated[index]!), line.qtyBase),
  }));
}

const lineData = (line: CostedLine) => ({
  productId: line.productId,
  qty: line.qty,
  unit: line.unit,
  factorUsed: line.factor,
  qtyBase: line.qtyBase,
  purchasePrice: line.purchasePrice,
  purchaseAmount: line.purchaseAmount,
  allocatedFreight: line.allocatedFreight,
  rollInfo: line.rollInfo,
  processingTypeId: line.processingTypeId,
  rollSearch: normalizeSearch(line.rollInfo ?? ""),
});

async function rewritePartnerLedger(
  tx: Tx,
  ctx: EngineCtx,
  actor: Actor,
  purchase: { id: number; partnerId: number; at: Date },
  total: Prisma.Decimal,
) {
  await removePartnerLedger(tx, "PURCHASE", purchase.id);
  await postPartnerLedger(tx, { periodId: ctx.period.id, partnerId: purchase.partnerId, side: "credit", amount: total, docType: "PURCHASE", docId: purchase.id, at: purchase.at, createdBy: actor.userId });
}

const auditSummary = (
  purchase: { code: string; partnerId: number; at: Date; freightCost: Prisma.Decimal; purchaseTotal: Prisma.Decimal },
  lineCount: number,
) => ({
  code: purchase.code,
  partnerId: purchase.partnerId,
  date: ymd(purchase.at),
  freightCost: purchase.freightCost.toString(),
  purchaseTotal: purchase.purchaseTotal.toString(),
  lineCount,
});

/** Runs inside an inventory transaction which has locked every input product. */
export async function createPurchase(
  ctx: EngineCtx,
  actor: Actor,
  input: PurchaseInput,
  now: Date = new Date(),
): Promise<{ id: number; code: string }> {
  assertWriter(actor, "purchase.create");
  await ensureSupplier(ctx.tx, input.partnerId);
  const lines = costLines(await prepareLines(ctx.tx, input.lines, new Set()), D(input.freightCost));
  const at = docTimestamp(input.date, now);
  const total = sum(lines.map((line) => line.purchaseAmount));
  const id = await nextDocId(ctx.tx, "purchases");
  const code = formatDocCode("PN", id);
  const purchase = await ctx.tx.purchase.create({
    data: {
      id, code, periodId: ctx.period.id, partnerId: input.partnerId, at,
      freightCost: D(input.freightCost), purchaseTotal: total, note: input.note || null, createdBy: actor.userId,
    },
  });
  for (const line of lines) {
    const row = await ctx.tx.purchaseLine.create({ data: { purchaseId: id, ...lineData(line) } });
    const { seq } = await postReceipt(ctx, {
      productId: line.stockProductId, qty: line.qtyBase, unitCost: line.unitCost,
      docType: "PURCHASE", docId: id, docLineId: row.id, at,
    });
    await ctx.tx.purchaseLine.update({ where: { id: row.id }, data: { seq } });
  }
  await rewritePartnerLedger(ctx.tx, ctx, actor, purchase, total);
  // Trả vượt tiền hàng của phiếu được phép: phần dư trừ vào nợ cũ với NCC (giống phiếu chi trả NCC lẻ).
  for (const p of input.payments ?? []) {
    await createPayment(ctx.tx, actor, { kind: "TRA_NCC", partnerId: input.partnerId, cashAccountId: p.cashAccountId, amount: p.amount, date: input.date, note: [`Trả tiền phiếu nhập ${code}`, p.note].filter(Boolean).join(" — ") }, now);
  }
  await writeAudit(ctx.tx, {
    userId: actor.userId, action: "purchase.create", entity: "Purchase", entityId: id,
    after: auditSummary(purchase, lines.length),
  });
  return { id, code };
}

export async function createPurchaseIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: PurchaseInput) {
  assertWriter(actor, "purchase.create");
  return withIdempotentInventoryTx(
    prisma,
    { userId: actor.userId, products: await lockIdsOf(prisma, input.lines), scope: "purchase.create", key },
    (ctx) => createPurchase(ctx, actor, input),
  );
}

async function lockPurchase(tx: Tx, id: number) {
  await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${id} FOR UPDATE`;
  const purchase = await tx.purchase.findUnique({ where: { id }, include: { lines: true } });
  if (!purchase) throw new DomainError("Không tìm thấy phiếu nhập.", 404);
  return purchase;
}

async function assertOldProductsLocked(ctx: EngineCtx, id: number) {
  const current = await productsOfDocument(ctx.tx, "PURCHASE", id);
  if (current.some((productId) => !ctx.locked.has(productId))) {
    throw new DomainError("Phiếu vừa được người khác sửa, hãy tải lại trang rồi thử lại.", 409);
  }
}

export async function updatePurchase(ctx: EngineCtx, actor: Actor, id: number, input: PurchaseInput, now: Date = new Date()): Promise<{ id: number }> {
  assertWriter(actor, "purchase.edit");
  const current = await lockPurchase(ctx.tx, id);
  if (current.isCancelled) throw new DomainError("Phiếu đã hủy, không sửa được.", 409);
  if (current.periodId !== ctx.period.id) throw new PeriodClosedError();
  await assertOldProductsLocked(ctx, id);

  if (current.lines.some(line => line.supplierOrderLineId !== null)) throw new DomainError("Phiếu nhận từ đơn đặt hàng không sửa dòng trực tiếp. Hãy hủy phiếu rồi nhận lại để giữ đúng đối chiếu.", 409);
  const owned = new Set(current.lines.map((line) => line.id));
  for (const line of input.lines) {
    if (line.id !== undefined && !owned.has(line.id)) throw new DomainError("Dòng hàng không thuộc phiếu này.", 400);
  }
  await ensureSupplier(ctx.tx, input.partnerId, current.partnerId);
  const lines = costLines(
    await prepareLines(ctx.tx, input.lines, new Set(current.lines.map((line) => line.productId))),
    D(input.freightCost),
  );
  const at = ymd(current.at) === input.date ? current.at : docTimestamp(input.date, now);
  const total = sum(lines.map((line) => line.purchaseAmount));
  const before = auditSummary(current, current.lines.length);

  await removeDocument(ctx, "PURCHASE", id);
  const kept = new Set(lines.flatMap((line) => line.id === undefined ? [] : [line.id]));
  await ctx.tx.purchaseLine.deleteMany({ where: { purchaseId: id, id: { notIn: [...kept] } } });
  for (const line of lines) {
    const row = line.id === undefined
      ? await ctx.tx.purchaseLine.create({ data: { purchaseId: id, ...lineData(line) } })
      : await ctx.tx.purchaseLine.update({ where: { id: line.id }, data: lineData(line) });
    const { seq } = await postReceipt(ctx, {
      productId: line.stockProductId, qty: line.qtyBase, unitCost: line.unitCost,
      docType: "PURCHASE", docId: id, docLineId: row.id, at,
    });
    await ctx.tx.purchaseLine.update({ where: { id: row.id }, data: { seq } });
  }
  const purchase = await ctx.tx.purchase.update({
    where: { id },
    data: { partnerId: input.partnerId, at, freightCost: D(input.freightCost), purchaseTotal: total, note: input.note || null },
  });
  await rewritePartnerLedger(ctx.tx, ctx, actor, purchase, total);
  await writeAudit(ctx.tx, {
    userId: actor.userId, action: "purchase.update", entity: "Purchase", entityId: id,
    before, after: auditSummary(purchase, lines.length),
  });
  return { id };
}

export async function updatePurchaseTx(prisma: PrismaClient, actor: Actor, id: number, input: PurchaseInput) {
  assertWriter(actor, "purchase.edit");
  const purchase = await prisma.purchase.findUnique({ where: { id }, select: { periodId: true } });
  if (!purchase) throw new DomainError("Không tìm thấy phiếu nhập.", 404);
  const products = sortedUnique([...(await productsOfDocument(prisma, "PURCHASE", id)), ...(await lockIdsOf(prisma, input.lines))]);
  return withInventoryTx(prisma, { userId: actor.userId, periodId: purchase.periodId, products }, (ctx) => updatePurchase(ctx, actor, id, input));
}

export async function cancelPurchase(ctx: EngineCtx, actor: Actor, id: number, reason: string, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "purchase.cancel");
  const current = await lockPurchase(ctx.tx, id);
  if (current.isCancelled) throw new DomainError("Phiếu đã hủy trước đó.", 409);
  if (current.periodId !== ctx.period.id) throw new PeriodClosedError();
  await assertOldProductsLocked(ctx, id);
  await removeDocument(ctx, "PURCHASE", id);
  await removePartnerLedger(ctx.tx, "PURCHASE", id);
  await ctx.tx.purchase.update({
    where: { id },
    data: { isCancelled: true, cancelledAt: now, cancelledBy: actor.userId, cancelReason: reason },
  });
  const linkedLines = current.lines.flatMap(line => line.supplierOrderLineId ? [line.supplierOrderLineId] : []);
  if (linkedLines.length) {
    const orders = await ctx.tx.supplierOrder.findMany({ where: { lines: { some: { id: { in: linkedLines } } } } });
    for (const order of orders) {
      await ctx.tx.supplierOrderNotice.create({ data: { userId: order.createdBy, orderId: order.id, purchaseId: id, message: `${order.code}: phiếu ${current.code} đã hủy, tiến độ nhận đã cập nhật lại.` } });
      await writeAudit(ctx.tx, { userId: actor.userId, action: "supplier-order.receipt-cancel", entity: "SupplierOrder", entityId: order.id, after: { purchaseId: id, reason } });
    }
  }
  await writeAudit(ctx.tx, {
    userId: actor.userId, action: "purchase.cancel", entity: "Purchase", entityId: id,
    before: auditSummary(current, current.lines.length), after: { isCancelled: true, reason },
  });
}

export async function cancelPurchaseTx(prisma: PrismaClient, actor: Actor, id: number, reason: string) {
  assertCan(actor.perms, "purchase.cancel");
  const purchase = await prisma.purchase.findUnique({ where: { id }, select: { periodId: true } });
  if (!purchase) throw new DomainError("Không tìm thấy phiếu nhập.", 404);
  const products = await productsOfDocument(prisma, "PURCHASE", id);
  return withInventoryTx(prisma, { userId: actor.userId, periodId: purchase.periodId, products }, (ctx) => cancelPurchase(ctx, actor, id, reason));
}

export async function updatePurchaseFreight(ctx: EngineCtx, actor: Actor, id: number, freightCost: number): Promise<void> {
  assertWriter(actor, "purchase.edit");
  if (!(freightCost >= 0)) throw new DomainError("Cước không được âm.", 400);
  const current = await lockPurchase(ctx.tx, id);
  if (current.isCancelled) throw new DomainError("Phiếu đã hủy, không sửa được.", 409);
  if (current.periodId !== ctx.period.id) throw new PeriodClosedError();
  await assertOldProductsLocked(ctx, id);

  const freight = D(freightCost);
  const allocated = FREIGHT_IN_COST
    ? allocateFreight(current.lines.map((line) => line.purchaseAmount), freight)
    : current.lines.map(() => D(0));
  for (const [index, line] of current.lines.entries()) {
    await ctx.tx.purchaseLine.update({ where: { id: line.id }, data: { allocatedFreight: allocated[index]! } });
    await updateLayerCost(ctx, {
      docType: "PURCHASE", docId: id, docLineId: line.id,
      unitCost: unitCostOf(line.purchaseAmount.plus(allocated[index]!), line.qtyBase),
    });
  }
  await ctx.tx.purchase.update({ where: { id }, data: { freightCost: freight } });
  await writeAudit(ctx.tx, {
    userId: actor.userId, action: "purchase.update_freight", entity: "Purchase", entityId: id,
    before: { freightCost: current.freightCost.toString() }, after: { freightCost: freight.toString() },
  });
}

export async function updatePurchaseFreightTx(prisma: PrismaClient, actor: Actor, id: number, freightCost: number) {
  assertWriter(actor, "purchase.edit");
  const purchase = await prisma.purchase.findUnique({ where: { id }, select: { periodId: true } });
  if (!purchase) throw new DomainError("Không tìm thấy phiếu nhập.", 404);
  const products = await productsOfDocument(prisma, "PURCHASE", id);
  return withInventoryTx(prisma, { userId: actor.userId, periodId: purchase.periodId, products }, (ctx) => updatePurchaseFreight(ctx, actor, id, freightCost));
}
