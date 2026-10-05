import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { ictYmd } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import { lockOrderForDelivery, rewriteDeliveryLedger } from "@/server/delivery/service";
import { DomainError } from "@/server/http/errors";
import {
  docTimestamp, PeriodClosedError, postIssue, productsOfDocument, removeDocument, withInventoryTx, type EngineCtx,
} from "@/server/inventory";
import { assertPrices, assertWriter, loadCustomer, orderExtras, planLines, type PlannedLine } from "./service";
import type { SaleOrderInput } from "./schemas";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const sortedUnique = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Ngày đơn không đổi → dùng lại `at` đã lưu (engine-fifo §3, tránh xê dịch thứ tự FIFO); đổi ngày mới tính `docTimestamp`. */
export const resolveEditAt = (current: Date, date: string, now: Date): Date => (ictYmd(current) === date ? current : docTimestamp(date, now));

/** Mọi loại `docType` của dòng sổ chiết khấu thuộc một đơn bán (lập, sửa, hủy, khôi phục). */
const DISCOUNT_DOC_TYPES = ["SALE", "SALE_EDIT", "SALE_CANCEL", "SALE_RESTORE"] as const;

/**
 * Đưa số dư chiết khấu tích lũy TỪNG DÒNG về giá trị mong muốn bằng dòng điều chỉnh theo hiệu số (không xoá dòng cũ →
 * còn dấu vết kiểm toán; hủy = dòng `amountOut`, khôi phục = dòng `amountIn`). Tất toán thật ở plan 05-D3.
 */
async function syncAccumDiscount(tx: Tx, o: { orderId: number; partnerId: number; periodId: number; userId: number; at: Date; label: (typeof DISCOUNT_DOC_TYPES)[number]; desired: Map<number, Prisma.Decimal> }) {
  const sums = await tx.discountLedger.groupBy({
    by: ["orderLineId"], where: { docId: o.orderId, docType: { in: [...DISCOUNT_DOC_TYPES] } }, _sum: { amountIn: true, amountOut: true },
  });
  const current = new Map(sums.flatMap((s) => (s.orderLineId === null ? [] : [[s.orderLineId, (s._sum.amountIn ?? D(0)).minus(s._sum.amountOut ?? D(0))] as const])));
  for (const [lineId, want] of o.desired) {
    const delta = want.minus(current.get(lineId) ?? D(0));
    if (delta.eq(0)) continue;
    await tx.discountLedger.create({
      data: {
        periodId: o.periodId, partnerId: o.partnerId, orderLineId: lineId, amountIn: delta.gt(0) ? delta : D(0), amountOut: delta.lt(0) ? delta.abs() : D(0),
        docType: o.label, docId: o.orderId, at: o.at, createdBy: o.userId,
      },
    });
  }
}

async function assertOldProductsLocked(ctx: EngineCtx, orderId: number) {
  const current = await productsOfDocument(ctx.tx, "SALE", orderId);
  if (current.some((productId) => !ctx.locked.has(productId))) throw new DomainError("Đơn vừa được người khác sửa, hãy tải lại trang rồi thử lại.", 409);
}

const deliveredOf = (l: { deliveryLines: { qty: Prisma.Decimal }[] }) => l.deliveryLines.reduce((s, d) => s.plus(d.qty), D(0));

// ───────────────────────────── SỬA ĐƠN ─────────────────────────────
export async function editSaleOrder(ctx: EngineCtx, actor: Actor, id: number, input: SaleOrderInput, now: Date = new Date()): Promise<{ id: number }> {
  assertWriter(actor, "order.edit");
  const tx = ctx.tx;
  const { order } = await lockOrderForDelivery(tx, actor, id);
  if (order.isCancelled) throw new DomainError("Đơn đã hủy, không sửa được. Hãy khôi phục đơn trước.", 409);
  if (order.isDraft) throw new DomainError("Đơn nháp chưa xuất kho — sửa qua luồng đơn nháp.", 409);
  if (order.periodId !== ctx.period.id) throw new PeriodClosedError();
  if ((await ctx.tx.goodsReturn.count({ where: { orderId: id, isCancelled: false } })) > 0) {
    throw new DomainError("Đơn đã có phiếu trả hàng. Hãy hủy phiếu trả hàng trước.", 409, "HAS_RETURN");
  }
  await assertOldProductsLocked(ctx, id);

  const existing = new Map(order.lines.map((l) => [l.id, l]));
  const hasDelivered = order.lines.some((l) => deliveredOf(l).gt(0));
  if (input.partnerId !== order.partnerId) {
    if (hasDelivered) throw new DomainError("Đơn đã có phiếu giao/công nợ, không đổi khách hàng được.", 400);
    await loadCustomer(tx, actor, input.partnerId);
  }
  const kept = new Set<number>();
  input.lines.forEach((l, i) => {
    if (l.id === undefined) return;
    const cur = existing.get(l.id);
    if (!cur) throw new DomainError(`Dòng ${i + 1}: không thuộc đơn này.`, 400);
    if (kept.has(l.id)) throw new DomainError(`Dòng ${i + 1}: bị trùng.`, 400);
    kept.add(l.id);
    const delivered = deliveredOf(cur);
    if (delivered.gt(0) && (l.productId !== cur.productId || l.unit !== cur.unit)) throw new DomainError(`Dòng ${i + 1}: đã giao ${delivered.toString()} ${cur.unit}, không đổi sản phẩm/đơn vị được.`, 400);
    if (D(l.qty).lt(delivered)) throw new DomainError(`Dòng ${i + 1}: đã giao ${delivered.toString()} ${cur.unit}, số lượng không được nhỏ hơn.`, 400);
  });
  const removed = order.lines.filter((l) => !kept.has(l.id));
  for (const l of removed) if (deliveredOf(l).gt(0)) throw new DomainError("Có dòng đã giao, không xoá được.", 400);

  // Ngày không đổi → dùng lại `at` đã lưu (engine-fifo §3); đổi ngày mới tính lại
  const at = resolveEditAt(order.orderDate, input.date, now);
  const lines = await planLines(tx, input, at, {
    keepInactive: new Set(order.lines.map((l) => l.productId)),
    pinned: new Map(order.lines.map((l) => [l.id, { productId: l.productId, processingTypeId: l.processingTypeId, bomVersionId: l.bomVersionId }])),
  });
  for (const l of lines) for (const i of l.issues) {
    if (!ctx.locked.has(i.productId)) throw new DomainError("Định mức hoặc dữ liệu vừa thay đổi, hãy tải lại trang rồi thử lại.", 409);
  }
  await assertPrices(tx, actor, input.partnerId, lines, (l: PlannedLine) => {
    const cur = l.input.id === undefined ? undefined : existing.get(l.input.id);
    return !!cur && cur.productId === l.input.productId && cur.unit === l.input.unit && cur.salePrice.eq(l.input.salePrice);
  });

  // 1) Số dư chiết khấu của dòng bị xoá về 0 rồi gỡ liên kết dòng (giữ dòng sổ làm lịch sử; FK RESTRICT không cho xoá dòng còn tham chiếu)
  const desired = new Map<number, Prisma.Decimal>(removed.map((l) => [l.id, D(0)]));
  await syncAccumDiscount(tx, { orderId: id, partnerId: order.partnerId, periodId: ctx.period.id, userId: actor.userId, at: now, label: "SALE_EDIT", desired });
  if (removed.length) await tx.discountLedger.updateMany({ where: { orderLineId: { in: removed.map((l) => l.id) } }, data: { orderLineId: null } });

  // 2) Kho: gỡ toàn bộ dòng xuất của đơn rồi ghi lại (engine tự giữ seq của dòng cũ theo khoá dòng/mã)
  await removeDocument(ctx, "SALE", id);
  if (removed.length) await tx.saleOrderLine.deleteMany({ where: { id: { in: removed.map((l) => l.id) } } });

  const accum = new Map<number, Prisma.Decimal>();
  for (const l of lines) {
    const data = {
      productId: l.input.productId, qty: D(l.input.qty), unit: l.input.unit, factorUsed: l.factor, qtyBase: l.qtyBase,
      salePrice: D(l.input.salePrice), discountNow: D(l.input.discountNow), discountAccum: D(l.input.discountAccum),
      processingTypeId: l.input.processingTypeId, bomVersionId: l.bomVersionId, at,
    };
    const row = l.input.id === undefined
      ? await tx.saleOrderLine.create({ data: { orderId: id, ...data } })
      : await tx.saleOrderLine.update({ where: { id: l.input.id }, data });
    await tx.saleLineIssue.deleteMany({ where: { orderLineId: row.id } });
    for (const issue of l.issues) {
      const { seq } = await postIssue(ctx, { productId: issue.productId, qty: issue.qtyBase, docType: "SALE", docId: id, docLineId: row.id, at });
      await tx.saleLineIssue.create({ data: { orderLineId: row.id, productId: issue.productId, qtyBase: issue.qtyBase, seq } });
    }
    accum.set(row.id, D(l.input.discountAccum));
  }

  // 3) Đơn, chiết khấu tích lũy, công nợ của các phiếu giao (giá trị dòng có thể đã đổi)
  const expectedChanged = ymd(order.expectedDeliveryDate) !== input.expectedDeliveryDate;
  await tx.saleOrder.update({
    where: { id },
    data: {
      partnerId: input.partnerId, orderDate: at, note: input.note || null, ...(await orderExtras(tx, actor, input, "edit")),
      expectedDeliveryDate: dateOnly(input.expectedDeliveryDate),
      // Người dùng chủ động dời lịch giao ⇒ coi là ngày giao gốc mới (CHECK: dự kiến ≥ gốc)
      ...(expectedChanged ? { originalDeliveryDate: dateOnly(input.expectedDeliveryDate) } : {}),
    },
  });
  await syncAccumDiscount(tx, { orderId: id, partnerId: input.partnerId, periodId: ctx.period.id, userId: actor.userId, at: now, label: "SALE_EDIT", desired: accum });
  if (input.partnerId !== order.partnerId) await tx.discountLedger.updateMany({ where: { docId: id, docType: { in: [...DISCOUNT_DOC_TYPES] } }, data: { partnerId: input.partnerId } });
  await rewriteDeliveryLedger(tx, actor, id);

  await writeAudit(tx, {
    userId: actor.userId, action: "sale.update", entity: "SaleOrder", entityId: id,
    before: { code: order.code, lineCount: order.lines.length }, after: { code: order.code, lineCount: lines.length },
  });
  return { id };
}

export async function editSaleOrderTx(prisma: PrismaClient, actor: Actor, id: number, input: SaleOrderInput, now: Date = new Date()) {
  assertWriter(actor, "order.edit");
  const order = await prisma.saleOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!order) throw new DomainError("Không tìm thấy đơn hàng.", 404);
  if (order.isDraft) return prisma.$transaction((tx) => updateDraftOrder(tx, actor, id, input, now));
  // Khoá cả mã cũ lẫn mã sẽ xuất theo kế hoạch mới (BOM ghim phiên bản của dòng không đổi)
  const planned = await planLines(prisma, input, resolveEditAt(order.orderDate, input.date, now), {
    keepInactive: new Set(order.lines.map((l) => l.productId)),
    pinned: new Map(order.lines.map((l) => [l.id, { productId: l.productId, processingTypeId: l.processingTypeId, bomVersionId: l.bomVersionId }])),
  });
  const products = sortedUnique([...(await productsOfDocument(prisma, "SALE", id)), ...planned.flatMap((l) => l.issues.map((i) => i.productId))]);
  return withInventoryTx(prisma, { userId: actor.userId, periodId: order.periodId, products }, (ctx) => editSaleOrder(ctx, actor, id, input, now));
}

// ───────────────────────────── HỦY ĐƠN ─────────────────────────────
export async function cancelSaleOrder(ctx: EngineCtx, actor: Actor, id: number, reason: string, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "order.cancel");
  const tx = ctx.tx;
  const { order } = await lockOrderForDelivery(tx, actor, id);
  if (order.isCancelled) throw new DomainError("Đơn đã hủy trước đó.", 409);
  if (order.isDraft) throw new DomainError("Đơn nháp chưa xuất kho — dùng \"Xóa nháp\" thay vì Hủy đơn.", 409);
  if (order.periodId !== ctx.period.id) throw new PeriodClosedError();
  // 34b: còn dính tiền/công nợ thì phải xử lý trước. (Phiếu thu/cọc: thêm ở C5; trả hàng: C6.)
  if (order.lines.some((l) => deliveredOf(l).gt(0))) {
    throw new DomainError("Đơn còn phiếu giao (đã ghi công nợ). Hãy hủy các phiếu giao trước khi hủy đơn.", 409, "HAS_DELIVERY");
  }
  if ((await tx.receipt.count({ where: { orderId: id, isCancelled: false } })) > 0) {
    throw new DomainError("Đơn còn tiền cọc. Hãy chuyển cọc thành số dư của khách hoặc hủy phiếu cọc trước khi hủy đơn.", 409, "HAS_DEPOSIT");
  }
  if ((await tx.goodsReturn.count({ where: { orderId: id, isCancelled: false } })) > 0) {
    throw new DomainError("Đơn đã có phiếu trả hàng. Hãy hủy phiếu trả hàng trước.", 409, "HAS_RETURN");
  }
  const inTrip = await tx.tripOrder.findFirst({ where: { orderId: id, trip: { status: { in: ["PLANNED", "ON_ROAD"] } } }, select: { trip: { select: { code: true } } } });
  if (inTrip) throw new DomainError(`Đơn đang nằm trong chuyến giao ${inTrip.trip.code}. Hãy hủy chuyến hoặc gỡ đơn khỏi chuyến trước.`, 409, "IN_TRIP");
  await assertOldProductsLocked(ctx, id);

  await removeDocument(ctx, "SALE", id); // hoàn kho + tính lại chuỗi; `at`/`seq` đã lưu ở dòng đơn để khôi phục
  await syncAccumDiscount(tx, {
    orderId: id, partnerId: order.partnerId, periodId: ctx.period.id, userId: actor.userId, at: now, label: "SALE_CANCEL",
    desired: new Map(order.lines.map((l) => [l.id, D(0)])),
  });
  await tx.saleOrder.update({ where: { id }, data: { isCancelled: true, cancelledAt: now, cancelledBy: actor.userId, cancelReason: reason } });
  await writeAudit(tx, { userId: actor.userId, action: "sale.cancel", entity: "SaleOrder", entityId: id, before: { code: order.code }, after: { isCancelled: true, reason } });
}

export async function cancelSaleOrderTx(prisma: PrismaClient, actor: Actor, id: number, reason: string) {
  assertCan(actor.perms, "order.cancel");
  const order = await prisma.saleOrder.findUnique({ where: { id }, select: { periodId: true } });
  if (!order) throw new DomainError("Không tìm thấy đơn hàng.", 404);
  const products = await productsOfDocument(prisma, "SALE", id);
  return withInventoryTx(prisma, { userId: actor.userId, periodId: order.periodId, products }, (ctx) => cancelSaleOrder(ctx, actor, id, reason));
}

// ───────────────────────────── KHÔI PHỤC ─────────────────────────────
export async function restoreSaleOrder(ctx: EngineCtx, actor: Actor, id: number, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "order.restore");
  const tx = ctx.tx;
  const { order } = await lockOrderForDelivery(tx, actor, id);
  if (!order.isCancelled) throw new DomainError("Đơn chưa bị hủy.", 409);
  if (order.periodId !== ctx.period.id) throw new PeriodClosedError();

  const issues = await tx.saleLineIssue.findMany({ where: { orderLineId: { in: order.lines.map((l) => l.id) } }, orderBy: [{ orderLineId: "asc" }, { productId: "asc" }] });
  for (const i of issues) if (!ctx.locked.has(i.productId)) throw new DomainError("Đơn vừa được người khác sửa, hãy tải lại trang rồi thử lại.", 409);
  const lineById = new Map(order.lines.map((l) => [l.id, l]));

  // Ghi lại ĐÚNG như lúc lập: cùng `at`, cùng `seq` ⇒ giữ vị trí trong chuỗi FIFO (thiếu tồn ⇒ dòng treo, theo engine)
  for (const i of issues) {
    const line = lineById.get(i.orderLineId)!;
    await postIssue(ctx, { productId: i.productId, qty: i.qtyBase, docType: "SALE", docId: id, docLineId: line.id, at: line.at, ...(i.seq === null ? {} : { seq: i.seq }) });
  }
  await syncAccumDiscount(tx, {
    orderId: id, partnerId: order.partnerId, periodId: ctx.period.id, userId: actor.userId, at: now, label: "SALE_RESTORE",
    desired: new Map(order.lines.map((l) => [l.id, l.discountAccum])),
  });
  await tx.saleOrder.update({ where: { id }, data: { isCancelled: false, cancelledAt: null, cancelledBy: null, cancelReason: null } });
  await writeAudit(tx, { userId: actor.userId, action: "sale.restore", entity: "SaleOrder", entityId: id, after: { code: order.code } });
}

export async function restoreSaleOrderTx(prisma: PrismaClient, actor: Actor, id: number) {
  assertCan(actor.perms, "order.restore");
  const order = await prisma.saleOrder.findUnique({ where: { id }, select: { periodId: true, lines: { select: { issues: { select: { productId: true } } } } } });
  if (!order) throw new DomainError("Không tìm thấy đơn hàng.", 404);
  const products = sortedUnique(order.lines.flatMap((l) => l.issues.map((i) => i.productId)));
  return withInventoryTx(prisma, { userId: actor.userId, periodId: order.periodId, products }, (ctx) => restoreSaleOrder(ctx, actor, id));
}

// ───────────────────────────── ĐƠN NHÁP (từ báo giá) ─────────────────────────────

/** Sửa đơn nháp: chưa có kho/sổ/phiếu nào tham chiếu nên thay toàn bộ dòng. Ngày đơn chốt lúc xác nhận. */
export async function updateDraftOrder(tx: Tx, actor: Actor, id: number, input: SaleOrderInput, now: Date = new Date()): Promise<{ id: number }> {
  assertWriter(actor, "order.edit");
  const { order } = await lockOrderForDelivery(tx, actor, id);
  if (!order.isDraft) throw new DomainError("Đơn đã xác nhận, không sửa theo luồng đơn nháp.", 409);
  if (input.partnerId !== order.partnerId) await loadCustomer(tx, actor, input.partnerId);
  const existing = new Map(order.lines.map((l) => [l.id, l]));
  const planned = await planLines(tx, input, now, { keepInactive: new Set(order.lines.map((l) => l.productId)) });
  await assertPrices(tx, actor, input.partnerId, planned, (l: PlannedLine) => {
    const cur = l.input.id === undefined ? undefined : existing.get(l.input.id);
    return !!cur && cur.productId === l.input.productId && cur.unit === l.input.unit && cur.salePrice.eq(l.input.salePrice);
  });
  await tx.saleOrderLine.deleteMany({ where: { orderId: id } });
  await tx.saleOrder.update({
    where: { id },
    data: {
      partnerId: input.partnerId, note: input.note || null, ...(await orderExtras(tx, actor, input, "edit")),
      expectedDeliveryDate: dateOnly(input.expectedDeliveryDate), originalDeliveryDate: dateOnly(input.expectedDeliveryDate),
      lines: {
        create: planned.map((l) => ({
          productId: l.input.productId, qty: D(l.input.qty), unit: l.input.unit, factorUsed: l.factor, qtyBase: l.qtyBase, salePrice: D(l.input.salePrice),
          discountNow: D(l.input.discountNow), discountAccum: D(l.input.discountAccum), processingTypeId: l.input.processingTypeId, at: now,
        })),
      },
    },
  });
  await writeAudit(tx, { userId: actor.userId, action: "sale.update_draft", entity: "SaleOrder", entityId: id, before: { code: order.code, lineCount: order.lines.length }, after: { code: order.code, lineCount: planned.length } });
  return { id };
}

/**
 * XÁC NHẬN đơn nháp ⇒ xuất kho FIFO ngay tại thời điểm hiện tại (D-25), BOM theo ngày xác nhận, chiết khấu tích lũy vào sổ.
 * Giá đã chốt từ báo giá nên không coi là "sửa giá".
 */
export async function confirmDraftOrder(ctx: EngineCtx, actor: Actor, id: number, now: Date = new Date()): Promise<{ id: number }> {
  assertWriter(actor, "order.create");
  const tx = ctx.tx;
  const { order } = await lockOrderForDelivery(tx, actor, id);
  if (!order.isDraft) throw new DomainError("Đơn đã được xác nhận.", 409);
  if (order.isCancelled) throw new DomainError("Đơn đã hủy.", 409);
  if (order.periodId !== ctx.period.id) throw new PeriodClosedError();
  const today = ictYmd(now);
  const at = docTimestamp(today, now);
  const expected = ymd(order.expectedDeliveryDate) < today ? today : ymd(order.expectedDeliveryDate);
  const lines = await planLines(tx, {
    partnerId: order.partnerId, date: today, expectedDeliveryDate: expected, note: order.note ?? "",
    lines: order.lines.map((l) => ({ id: l.id, productId: l.productId, unit: l.unit, qty: Number(l.qty), salePrice: Number(l.salePrice), discountNow: Number(l.discountNow), discountAccum: Number(l.discountAccum), processingTypeId: l.processingTypeId })),
  }, at, { keepInactive: new Set(order.lines.map((l) => l.productId)) });
  for (const l of lines) for (const i of l.issues) {
    if (!ctx.locked.has(i.productId)) throw new DomainError("Định mức hoặc dữ liệu vừa thay đổi, hãy tải lại trang rồi thử lại.", 409);
  }

  const accum = new Map<number, Prisma.Decimal>();
  for (const l of lines) {
    const row = await tx.saleOrderLine.update({ where: { id: l.input.id! }, data: { at, bomVersionId: l.bomVersionId } });
    await tx.saleLineIssue.deleteMany({ where: { orderLineId: row.id } });
    for (const issue of l.issues) {
      const { seq } = await postIssue(ctx, { productId: issue.productId, qty: issue.qtyBase, docType: "SALE", docId: id, docLineId: row.id, at });
      await tx.saleLineIssue.create({ data: { orderLineId: row.id, productId: issue.productId, qtyBase: issue.qtyBase, seq } });
    }
    accum.set(row.id, row.discountAccum);
  }
  await syncAccumDiscount(tx, { orderId: id, partnerId: order.partnerId, periodId: ctx.period.id, userId: actor.userId, at: now, label: "SALE", desired: accum });
  await tx.saleOrder.update({ where: { id }, data: { isDraft: false, orderDate: at, expectedDeliveryDate: dateOnly(expected), originalDeliveryDate: dateOnly(expected) } });
  await writeAudit(tx, { userId: actor.userId, action: "sale.confirm", entity: "SaleOrder", entityId: id, after: { code: order.code, lineCount: lines.length } });
  return { id };
}

export async function confirmDraftOrderTx(prisma: PrismaClient, actor: Actor, id: number, now: Date = new Date()) {
  assertWriter(actor, "order.create");
  const order = await prisma.saleOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!order) throw new DomainError("Không tìm thấy đơn hàng.", 404);
  if (!order.isDraft) throw new DomainError("Đơn đã được xác nhận.", 409);
  const today = ictYmd(now);
  const planned = await planLines(prisma, {
    partnerId: order.partnerId, date: today, expectedDeliveryDate: today, note: "",
    lines: order.lines.map((l) => ({ id: l.id, productId: l.productId, unit: l.unit, qty: Number(l.qty), salePrice: Number(l.salePrice), discountNow: Number(l.discountNow), discountAccum: Number(l.discountAccum), processingTypeId: l.processingTypeId })),
  }, docTimestamp(today, now), { keepInactive: new Set(order.lines.map((l) => l.productId)) });
  const products = sortedUnique(planned.flatMap((l) => l.issues.map((i) => i.productId)));
  return withInventoryTx(prisma, { userId: actor.userId, periodId: order.periodId, products }, (ctx) => confirmDraftOrder(ctx, actor, id, now));
}

/**
 * Xóa hẳn đơn NHÁP (34c) — chỉ đơn chưa phát sinh gì: chưa xuất kho, không phiếu giao, không tiền cọc còn hiệu lực.
 * FK RESTRICT ở DB là lớp chặn thứ hai. Báo giá nguồn quay về SENT để chuyển lại được.
 */
export async function deleteDraftOrder(tx: Tx, actor: Actor, id: number): Promise<void> {
  assertCan(actor.perms, "order.delete_draft");
  const { order } = await lockOrderForDelivery(tx, actor, id);
  if (!order.isDraft) throw new DomainError("Chỉ xóa hẳn được đơn nháp. Đơn đã xác nhận hãy dùng Hủy đơn.", 409);
  if ((await tx.receipt.count({ where: { orderId: id, isCancelled: false } })) > 0) {
    throw new DomainError("Đơn nháp còn tiền cọc. Hãy chuyển cọc thành số dư của khách hoặc hủy phiếu cọc trước.", 409, "HAS_DEPOSIT");
  }
  const quote = await tx.quote.findUnique({ where: { convertedOrderId: id }, select: { id: true } });
  if (quote) await tx.quote.update({ where: { id: quote.id }, data: { status: "SENT", convertedOrderId: null } });
  await tx.receipt.updateMany({ where: { orderId: id }, data: { orderId: null } }); // phiếu cọc đã hủy giữ lịch sử, không chặn xoá (FK RESTRICT)
  await tx.saleOrder.delete({ where: { id } });
  await writeAudit(tx, { userId: actor.userId, action: "sale.delete_draft", entity: "SaleOrder", entityId: id, before: { code: order.code, lineCount: order.lines.length } });
}
