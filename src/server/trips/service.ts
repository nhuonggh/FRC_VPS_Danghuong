import { Prisma, type DeliveryStatus, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { ictStartOfDay, ictYmd, toIct } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import { postCashLedger } from "@/server/cash/ledger";
import { addReviewEvent } from "@/server/cash/vouchers";
import { partnerBalance } from "@/server/debt/balance";
import { postPartnerLedger, removePartnerLedger } from "@/server/debt/ledger";
import { cancelDeliveryNoteCore, createDeliveryNoteCore, syncDeliveryStatus } from "@/server/delivery/service";
import { orderPaid, syncPaymentStatus } from "@/server/deposits/status";
import { DomainError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { docTimestamp, PeriodClosedError } from "@/server/inventory";
import { assertDocDateInPeriod, getOpenPeriod } from "@/server/period/guard";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import { lineAmountOf } from "@/server/sales/queries";
import type { ConfirmTripInput, TripInput, TripResultInput } from "./schemas";
import { remainingToDeliver as remainingOf } from "./remaining";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

// ── tiện ích ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function lockTrip(tx: Tx, id: number) {
  await tx.$queryRaw`SELECT id FROM trips WHERE id = ${id} FOR UPDATE`;
  const t = await tx.trip.findUnique({ where: { id }, include: { stops: { orderBy: { seq: "asc" } } } });
  if (!t) throw new DomainError("Không tìm thấy chuyến giao.", 404);
  return t;
}
async function assertTripPeriod(tx: Tx, periodId: number) {
  const period = await getOpenPeriod(tx);
  if (periodId !== period.id) throw new PeriodClosedError();
  return period;
}

/** Đưa trục giao hàng của đơn về đúng theo số đã giao (NEW/PARTIAL/DELIVERED) — dùng khi gỡ đơn khỏi chuyến. */
async function resetDeliveryStatus(tx: Tx, orderId: number): Promise<void> {
  const o = await tx.saleOrder.findUniqueOrThrow({ where: { id: orderId }, select: { deliveryStatus: true, lines: { select: { qty: true, deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } } } } } });
  const total = o.lines.reduce((s, l) => s.plus(l.qty), D(0)); const done = o.lines.reduce((s, l) => s.plus(l.qty.minus(remainingOf(l))), D(0));
  const next: DeliveryStatus = done.gte(total) && total.gt(0) ? "DELIVERED" : done.gt(0) ? "PARTIAL" : "NEW";
  if (o.deliveryStatus !== next) await tx.saleOrder.update({ where: { id: orderId }, data: { deliveryStatus: next } });
}
const setDeliveryStatus = (tx: Tx, orderId: number, status: DeliveryStatus) => tx.saleOrder.update({ where: { id: orderId }, data: { deliveryStatus: status } });

// ── xếp chuyến (38) ──────────────────────────────────────────────────────────────────────────────────────────────────
export async function createTrip(tx: Tx, actor: Actor, input: TripInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertCan(actor.perms, "trip.manage");
  const period = await getOpenPeriod(tx);
  const today = toIct(now);
  const day = input.date.split("-").map(Number) as [number, number, number];
  const tripDate = ictStartOfDay(day[0], day[1] - 1, day[2]);
  if (tripDate < ictStartOfDay(today.y, today.m, today.d - 7)) throw new DomainError("Ngày chuyến quá xa trong quá khứ (tối đa 7 ngày trước).", 400);
  if (tripDate > ictStartOfDay(today.y, today.m, today.d + 60)) throw new DomainError("Ngày chuyến quá xa trong tương lai (tối đa 60 ngày).", 400);

  const [vehicle, driver, assistant, route] = await Promise.all([
    tx.vehicle.findUnique({ where: { id: input.vehicleId }, select: { isActive: true, plate: true } }),
    tx.driver.findUnique({ where: { id: input.driverId }, select: { isActive: true, isAssistant: true, name: true } }),
    input.assistantId === null ? null : tx.driver.findUnique({ where: { id: input.assistantId }, select: { isActive: true, isAssistant: true, name: true } }),
    input.routeId === null ? null : tx.route.findUnique({ where: { id: input.routeId }, select: { isActive: true } }),
  ]);
  if (!vehicle?.isActive) throw new DomainError("Xe không hợp lệ hoặc đã tắt.", 400);
  if (!driver?.isActive || driver.isAssistant) throw new DomainError("Lái xe không hợp lệ (hoặc đang là phụ xe / đã tắt).", 400);
  if (input.assistantId !== null && (!assistant?.isActive || !assistant.isAssistant)) throw new DomainError("Phụ xe không hợp lệ (hoặc không phải phụ xe / đã tắt).", 400);
  if (input.routeId !== null && !route?.isActive) throw new DomainError("Tuyến không hợp lệ hoặc đã tắt.", 400);

  // Không chặn xe / lái / phụ đã có chuyến khác (cùng ngày hay chuyến cũ chưa nhập kết quả): thực tế kế toán chưa kịp nhập kết quả
  // thì hôm sau lái xe đã đi giao đơn mới, và một ngày có thể chạy nhiều chuyến. Chỉ chặn ở mức ĐƠN (xem ORDER_IN_TRIP bên dưới).

  // Khoá các đơn theo thứ tự id (tránh deadlock) rồi kiểm từng đơn
  const ids = [...input.orderIds].sort((a, b) => a - b);
  await tx.$queryRaw`SELECT id FROM sale_orders WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  const orders = await tx.saleOrder.findMany({ where: { id: { in: ids } }, include: { lines: { include: { returnLines: { where: { goodsReturn: { isCancelled: false, undelivered: true } }, select: { qty: true } }, deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } } } } } });
  const byId = new Map(orders.map((o) => [o.id, o]));
  const busy = await tx.tripOrder.findMany({ where: { orderId: { in: ids }, result: null, trip: { status: { in: ["PLANNED", "ON_ROAD"] } } }, select: { orderId: true, trip: { select: { code: true } } } });
  const busyBy = new Map(busy.map((b) => [b.orderId, b.trip.code]));
  for (const orderId of input.orderIds) {
    const o = byId.get(orderId);
    if (!o) throw new DomainError("Không tìm thấy đơn hàng.", 404);
    if (o.isCancelled) throw new DomainError(`Đơn ${o.code} đã hủy.`, 409);
    if (o.isDraft) throw new DomainError(`Đơn ${o.code} còn là nháp (chưa xác nhận).`, 409);
    // Đơn của kỳ đã kết sổ vẫn xếp chuyến giao nốt được (chuyến mang kỳ đang mở) — Plan 07 F1d, spec 4.4
    if (!o.lines.some((l) => remainingOf(l).gt(0))) throw new DomainError(`Đơn ${o.code} không còn hàng để giao (đã giao hoặc trả về kho hết).`, 409);
    if (busyBy.has(orderId)) throw new DomainError(`Đơn ${o.code} đang nằm trong chuyến ${busyBy.get(orderId)} chưa có kết quả.`, 409, "ORDER_IN_TRIP");
  }
  const id = await nextDocId(tx, "trips");
  const code = formatDocCode("CH", id);
  await tx.trip.create({
    data: { id, code, periodId: period.id, tripDate, routeId: input.routeId, vehicleId: input.vehicleId, driverId: input.driverId, assistantId: input.assistantId, note: input.note || null, createdBy: actor.userId, stops: { create: input.orderIds.map((orderId, i) => ({ orderId, seq: i + 1 })) } },
  });
  for (const orderId of input.orderIds) {
    const st = byId.get(orderId)!.deliveryStatus;
    if (st === "NEW" || st === "FAILED" || st === "WAITING_STOCK") await setDeliveryStatus(tx, orderId, "READY");
  }
  await writeAudit(tx, { userId: actor.userId, action: "trip.create", entity: "Trip", entityId: id, after: { code, date: input.date, vehicle: vehicle.plate, driver: driver.name, orders: orders.map((o) => o.code) } });
  return { id, code };
}

/** Xuất phát: chuyến PLANNED → ON_ROAD, các đơn chưa có kết quả → DELIVERING. */
export async function departTrip(tx: Tx, actor: Actor, id: number, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "trip.manage");
  const t = await lockTrip(tx, id);
  await assertTripPeriod(tx, t.periodId);
  if (t.status !== "PLANNED") throw new DomainError("Chuyến không ở trạng thái “Đã xếp”.", 409);
  await tx.trip.update({ where: { id }, data: { status: "ON_ROAD", departedAt: now } });
  for (const s of t.stops) if (s.result === null) await setDeliveryStatus(tx, s.orderId, "DELIVERING");
  await writeAudit(tx, { userId: actor.userId, action: "trip.depart", entity: "Trip", entityId: id, after: { code: t.code } });
}

/** Hủy chuyến (chưa có kết quả nào): trả các đơn về trạng thái chưa xếp. */
export async function cancelTrip(tx: Tx, actor: Actor, id: number, reason: string, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "trip.manage");
  const t = await lockTrip(tx, id);
  await assertTripPeriod(tx, t.periodId);
  if (t.stops.some((s) => s.result !== null)) throw new DomainError("Chuyến đã có điểm giao được nhập kết quả — xóa kết quả từng điểm (khi chưa đối soát) trước khi hủy chuyến.", 409, "TRIP_HAS_RESULTS");
  if (t.status !== "PLANNED" && t.status !== "ON_ROAD") throw new DomainError("Chỉ hủy được chuyến đã xếp / đang đi.", 409);
  await tx.trip.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now, cancelledBy: actor.userId, cancelReason: reason } });
  for (const s of t.stops) await resetDeliveryStatus(tx, s.orderId);
  await writeAudit(tx, { userId: actor.userId, action: "trip.cancel", entity: "Trip", entityId: id, before: { code: t.code }, after: { reason } });
}

// ── nhập kết quả giao (40) ───────────────────────────────────────────────────────────────────────────────────────────
/** Xóa kết quả một điểm giao: hủy phiếu giao (công nợ ghi khi giao) + công nợ tiền lái xe thu, đưa điểm về “chưa có kết quả”. */
async function revertStop(tx: Tx, actor: Actor, stop: { id: number; orderId: number; deliveryNoteId: number | null }): Promise<void> {
  if (stop.deliveryNoteId !== null) {
    await tx.tripOrder.update({ where: { id: stop.id }, data: { deliveryNoteId: null } });
    await cancelDeliveryNoteCore(tx, actor, stop.deliveryNoteId);
  }
  await removePartnerLedger(tx, "TRIP_COLLECT", stop.id);
  await removePartnerLedger(tx, "TRIP_DISCOUNT", stop.id);
  await tx.tripOrder.update({ where: { id: stop.id }, data: { result: null, dueAmount: null, cashAmount: 0, transferAmount: 0, cashAccountId: null, transferAccountId: null, debtAmount: 0, discountAmount: 0, overAmount: 0, promiseDate: null, resultNote: null, resultAt: null, resultBy: null, handledAt: null, handledBy: null, handledNote: null } });
}

export async function recordTripResult(tx: Tx, actor: Actor, tripId: number, input: TripResultInput, now: Date = new Date()): Promise<{ stopId: number; due: string }> {
  assertCan(actor.perms, "trip.manage");
  const t = await lockTrip(tx, tripId);
  await assertTripPeriod(tx, t.periodId);
  if (t.status === "CANCELLED" || t.status === "SETTLED" || t.status === "CONFIRMED") throw new DomainError("Chuyến đã đối soát/hủy — không nhập lại kết quả được.", 409, "TRIP_LOCKED");
  const stop = t.stops.find((s) => s.orderId === input.orderId);
  if (!stop) throw new DomainError("Đơn này không thuộc chuyến.", 404);
  await tx.$queryRaw`SELECT id FROM sale_orders WHERE id = ${input.orderId} FOR UPDATE`;
  if (stop.result !== null) await revertStop(tx, actor, stop);

  const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: input.orderId }, include: { partner: { select: { allowCredit: true, debtLimit: true, name: true } }, lines: { orderBy: { id: "asc" }, include: { returnLines: { where: { goodsReturn: { isCancelled: false, undelivered: true } }, select: { qty: true } }, deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } } } } } });
  if (order.isCancelled) throw new DomainError("Đơn đã hủy.", 409);
  const at = docTimestamp(ictYmd(now), now);
  const round = (n: number) => D(n).toDecimalPlaces(2);
  const cash = round(input.cashAmount), transfer = round(input.transferAmount), debt = round(input.debtAmount), discount = round(input.discountAmount);
  for (const [amount, accId] of [[cash, input.cashAccountId], [transfer, input.transferAccountId]] as const) {
    if (!amount.gt(0) || accId === null) continue;
    if (!(await tx.cashAccount.findUnique({ where: { id: accId }, select: { isActive: true } }))?.isActive) throw new DomainError("Quỹ/tài khoản không hợp lệ hoặc đã tắt.", 400);
  }

  let noteId: number | null = null;
  if (input.result !== "KHONG_GIAO") {
    const deliver = input.result === "GIAO_MOT_PHAN"
      ? input.lines.filter((l) => l.qty > 0)
      : order.lines.map((l) => ({ orderLineId: l.id, qty: Number(remainingOf(l).toString()) })).filter((l) => l.qty > 0);
    if (input.result === "GIAO_MOT_PHAN") {
      const remainingTotal = order.lines.reduce((s, l) => s.plus(remainingOf(l)), D(0));
      const sum = deliver.reduce((s, l) => s.plus(l.qty), D(0));
      if (sum.gte(remainingTotal)) throw new DomainError("Đã giao đủ số còn lại — chọn “Giao đủ”.", 400);
    }
    if (deliver.length === 0) throw new DomainError("Đơn đã giao hết, không còn gì để giao.", 409);
    const note = await createDeliveryNoteCore(tx, actor, { orderId: order.id, date: ictYmd(now), note: `Chuyến ${t.code}`, lines: deliver }, now);
    noteId = note.id;
  }
  // Phải thu = giá trị đã giao lũy kế − tiền đã thu của đơn (≥ 0)
  const delivered = (await tx.partnerLedger.aggregate({ where: { docType: "DELIVERY", docId: { in: (await tx.deliveryNote.findMany({ where: { orderId: order.id, isCancelled: false }, select: { id: true } })).map((n) => n.id) } }, _sum: { debit: true } }))._sum.debit ?? D(0);
  const paid = await orderPaid(tx, order.id, stop.id);
  const due = delivered.minus(paid).gt(0) ? delivered.minus(paid) : D(0);
  const collected = cash.plus(transfer);
  if (discount.gt(due)) throw new DomainError(`Tiền bớt (${discount.toFixed(0)}) vượt số phải thu (${due.toFixed(0)}).`, 400, "DISCOUNT_EXCEEDS_DUE");
  // Thu nhiều hơn phải thu được phép (khách trả nợ cũ / trả dư) nhưng phải ghi lý do; phần vượt đi vào công nợ chung của khách
  const over = collected.plus(discount).minus(due).gt(0) ? collected.plus(discount).minus(due) : D(0);
  if (over.gt(0) && !input.note) throw new DomainError(`Tiền thu vượt số phải thu ${over.toFixed(0)} — nhập lý do (VD: khách trả nợ cũ).`, 400, "OVER_NEEDS_NOTE");
  if (collected.gt(0)) await postPartnerLedger(tx, { periodId: t.periodId, partnerId: order.partnerId, side: "credit", amount: collected, docType: "TRIP_COLLECT", docId: stop.id, at, createdBy: actor.userId });
  if (discount.gt(0)) await postPartnerLedger(tx, { periodId: t.periodId, partnerId: order.partnerId, side: "credit", amount: discount, docType: "TRIP_DISCOUNT", docId: stop.id, at, createdBy: actor.userId });
  if (input.result === "GHI_NO" || (input.result === "GIAO_MOT_PHAN" && debt.gt(0))) {
    if (!order.partner.allowCredit) throw new DomainError(`Khách ${order.partner.name} không được ghi nợ.`, 409, "CREDIT_NOT_ALLOWED");
    const bal = (await partnerBalance(tx, order.partnerId)).balance;
    if (order.partner.debtLimit.gt(0) && bal.gt(order.partner.debtLimit)) throw new DomainError(`Ghi nợ làm công nợ (${bal.toFixed(0)}) vượt hạn mức ${order.partner.debtLimit.toFixed(0)} của khách.`, 409, "CREDIT_LIMIT");
  }
  await tx.tripOrder.update({
    where: { id: stop.id },
    data: { result: input.result, dueAmount: due, cashAmount: cash, transferAmount: transfer, cashAccountId: cash.gt(0) ? input.cashAccountId : null, transferAccountId: transfer.gt(0) ? input.transferAccountId : null, debtAmount: debt, discountAmount: discount, overAmount: over, promiseDate: input.promiseDate ? new Date(`${input.promiseDate}T00:00:00Z`) : null, resultNote: input.note || null, deliveryNoteId: noteId, resultAt: now, resultBy: actor.userId },
  });
  // Trục giao hàng + thanh toán của đơn
  if (input.result === "KHONG_GIAO") await setDeliveryStatus(tx, order.id, "FAILED");
  else await syncDeliveryStatus(tx, order.id);
  if (input.result !== "KHONG_GIAO") {
    const fresh = await tx.saleOrder.findUniqueOrThrow({ where: { id: order.id }, select: { deliveryStatus: true } });
    const outstanding = due.minus(collected).minus(discount).plus(over);
    const next = outstanding.lte(0) ? (fresh.deliveryStatus === "DELIVERED" ? "PAID" : "PARTIAL") : input.result === "HEN_TRA" ? "PROMISED" : collected.gt(0) ? "PARTIAL" : "DEBT";
    await tx.saleOrder.update({ where: { id: order.id }, data: { paymentStatus: next } });
  }
  // Đủ kết quả ⇒ chuyến “đã về”
  const pending = await tx.tripOrder.count({ where: { tripId, result: null } });
  if (pending === 0 && (t.status === "PLANNED" || t.status === "ON_ROAD")) await tx.trip.update({ where: { id: tripId }, data: { status: "RETURNED", returnedAt: now } });
  await writeAudit(tx, { userId: actor.userId, action: "trip.result", entity: "Trip", entityId: tripId, after: { orderId: order.id, orderCode: order.code, result: input.result, due: due.toString(), cash: cash.toString(), transfer: transfer.toString(), debt: debt.toString(), discount: discount.toString(), over: over.toString() } });
  return { stopId: stop.id, due: due.toString() };
}

/** Xóa kết quả một điểm giao (chuyến chưa đối soát): hoàn công nợ/phiếu giao, chuyến “đã về” quay lại “đang đi”. */
export async function clearTripResult(tx: Tx, actor: Actor, tripId: number, orderId: number): Promise<void> {
  assertCan(actor.perms, "trip.manage");
  const t = await lockTrip(tx, tripId);
  await assertTripPeriod(tx, t.periodId);
  if (t.status === "CANCELLED" || t.status === "SETTLED" || t.status === "CONFIRMED") throw new DomainError("Chuyến đã đối soát/hủy — không xóa kết quả được.", 409, "TRIP_LOCKED");
  const stop = t.stops.find((s) => s.orderId === orderId);
  if (!stop) throw new DomainError("Đơn này không thuộc chuyến.", 404);
  if (stop.result === null) throw new DomainError("Điểm giao chưa có kết quả.", 409);
  await tx.$queryRaw`SELECT id FROM sale_orders WHERE id = ${orderId} FOR UPDATE`;
  await revertStop(tx, actor, stop);
  await resetDeliveryStatus(tx, orderId);
  // đơn vẫn nằm trong chuyến chưa có kết quả ở điểm này ⇒ trục giao hàng phản ánh chuyến; trục thanh toán tính lại từ tiền đã thu
  const cur = await tx.saleOrder.findUniqueOrThrow({ where: { id: orderId }, select: { deliveryStatus: true } });
  if (cur.deliveryStatus === "NEW") await setDeliveryStatus(tx, orderId, t.status === "PLANNED" ? "READY" : "DELIVERING");
  await tx.saleOrder.update({ where: { id: orderId }, data: { paymentStatus: "UNPAID" } });
  await syncPaymentStatus(tx, orderId);
  if (t.status === "RETURNED") await tx.trip.update({ where: { id: tripId }, data: { status: "ON_ROAD", returnedAt: null } });
  await writeAudit(tx, { userId: actor.userId, action: "trip.result.clear", entity: "Trip", entityId: tripId, before: { orderId, result: stop.result } });
}

// ── đối soát (41) ────────────────────────────────────────────────────────────────────────────────────────────────────
export async function settleTrip(tx: Tx, actor: Actor, id: number, reason: string, now: Date = new Date()): Promise<{ diff: string }> {
  assertCan(actor.perms, "trip.settle");
  const t = await lockTrip(tx, id);
  await assertTripPeriod(tx, t.periodId);
  if (t.status !== "RETURNED") throw new DomainError(t.status === "SETTLED" || t.status === "CONFIRMED" ? "Chuyến đã đối soát." : "Chỉ đối soát chuyến đã có đủ kết quả các điểm giao.", 409, "TRIP_NOT_READY");
  if (t.stops.some((s) => s.result === null)) throw new DomainError("Còn điểm giao chưa nhập kết quả.", 409);
  const sum = (f: (s: (typeof t.stops)[number]) => Prisma.Decimal | null) => t.stops.reduce((a, s) => a.plus(f(s) ?? 0), D(0));
  const expected = sum((s) => s.dueAmount), cash = sum((s) => s.cashAmount), transfer = sum((s) => s.transferAmount), debt = sum((s) => s.debtAmount);
  // Phải thu + phần thu vượt (đã có lý do ở từng điểm) = mặt + CK + ghi nợ + bớt
  const diff = expected.plus(sum((s) => s.overAmount)).minus(cash).minus(transfer).minus(debt).minus(sum((s) => s.discountAmount));
  if (!diff.isZero() && !reason) throw new DomainError(`Chênh lệch ${diff.toFixed(0)} giữa số phải thu và tiền mặt + chuyển khoản + ghi nợ + bớt — nhập lý do.`, 400, "DIFF_REASON_REQUIRED");
  await tx.trip.update({ where: { id }, data: { status: "SETTLED", settledAt: now, settledBy: actor.userId, expectedAmount: expected, cashAmount: cash, transferAmount: transfer, debtAmount: debt, diffAmount: diff, diffReason: diff.isZero() ? null : reason } });
  await writeAudit(tx, { userId: actor.userId, action: "trip.settle", entity: "Trip", entityId: id, after: { code: t.code, expected: expected.toString(), cash: cash.toString(), transfer: transfer.toString(), debt: debt.toString(), diff: diff.toString(), reason } });
  return { diff: diff.toString() };
}

/**
 * Thủ quỹ xác nhận đã nhận tiền của chuyến (D-35): sinh phiếu thu THU_NO cho từng điểm (tiền mặt → quỹ, chuyển khoản → tài khoản NH),
 * chờ thủ quỹ hậu kiểm như mọi phiếu thu. Công nợ đã ghi có lúc nhập kết quả (TRIP_COLLECT) nên phiếu chỉ ghi sổ quỹ.
 */
export async function confirmTripCash(tx: Tx, actor: Actor, id: number, input: ConfirmTripInput, now: Date = new Date()): Promise<{ receipts: number }> {
  assertCan(actor.perms, "trip.confirm_cash");
  const t = await lockTrip(tx, id);
  const period = await assertTripPeriod(tx, t.periodId);
  if (t.status === "CONFIRMED") throw new DomainError("Thủ quỹ đã xác nhận chuyến này.", 409, "ALREADY_CONFIRMED");
  if (t.status !== "SETTLED") throw new DomainError("Chỉ xác nhận chuyến đã đối soát.", 409, "TRIP_NOT_SETTLED");
  // Mỗi điểm giao có quỹ/TK riêng (chọn lúc nhập kết quả); điểm cũ chưa chọn thì dùng quỹ/TK thủ quỹ chọn ở đây.
  const cashOf = (s: (typeof t.stops)[number]) => s.cashAccountId ?? input.cashAccountId, bankOf = (s: (typeof t.stops)[number]) => s.transferAccountId ?? input.transferAccountId;
  const needCash = t.stops.some((s) => s.cashAmount.gt(0) && s.cashAccountId === null), needBank = t.stops.some((s) => s.transferAmount.gt(0) && s.transferAccountId === null);
  if (needCash && input.cashAccountId === null) throw new DomainError("Chọn quỹ tiền mặt nhận tiền.", 400);
  if (needBank && input.transferAccountId === null) throw new DomainError("Chọn tài khoản ngân hàng nhận chuyển khoản.", 400);
  for (const accId of new Set([...t.stops.flatMap((s) => [s.cashAmount.gt(0) ? cashOf(s) : null, s.transferAmount.gt(0) ? bankOf(s) : null]), ...(needCash ? [input.cashAccountId] : []), ...(needBank ? [input.transferAccountId] : [])])) {
    if (accId === null) continue;
    const a = await tx.cashAccount.findUnique({ where: { id: accId }, select: { isActive: true } });
    if (!a?.isActive) throw new DomainError("Quỹ/tài khoản không hợp lệ hoặc đã tắt.", 400);
  }
  const at = docTimestamp(ictYmd(now), now);
  assertDocDateInPeriod(period, at);
  const orders = new Map((await tx.saleOrder.findMany({ where: { id: { in: t.stops.map((s) => s.orderId) } }, select: { id: true, code: true, partnerId: true } })).map((o) => [o.id, o]));
  let n = 0;
  for (const s of t.stops) {
    const o = orders.get(s.orderId)!;
    // Phần thu vượt phải thu (trả nợ cũ/dư) tách thành phiếu thu riêng KHÔNG gắn đơn — lấy từ tiền mặt trước, rồi chuyển khoản
    const overCash = s.overAmount.lt(s.cashAmount) ? s.overAmount : s.cashAmount;
    const overBank = s.overAmount.minus(overCash);
    const parts: [Prisma.Decimal, number | null, string, boolean][] = [
      [s.cashAmount.minus(overCash), cashOf(s), "tiền mặt", false], [s.transferAmount.minus(overBank), bankOf(s), "chuyển khoản", false],
      [overCash, cashOf(s), "tiền mặt · thu vượt (nợ cũ/dư)", true], [overBank, bankOf(s), "chuyển khoản · thu vượt (nợ cũ/dư)", true],
    ];
    for (const [amount, accountId, label, isOver] of parts) {
      if (!amount.gt(0) || accountId === null) continue;
      const rid = await nextDocId(tx, "receipts");
      const code = formatDocCode("PT", rid);
      await tx.receipt.create({ data: { id: rid, code, periodId: period.id, partnerId: o.partnerId, type: "THU_NO", orderId: isOver ? null : o.id, amount, cashAccountId: accountId, at, note: `Chuyến ${t.code} · ${o.code} · ${label}${isOver && s.resultNote ? ` · ${s.resultNote}` : ""}`, tripId: id, createdBy: actor.userId } });
      await postCashLedger(tx, { periodId: period.id, cashAccountId: accountId, side: "in", amount, docType: "RECEIPT", docId: rid, at, createdBy: actor.userId });
      await addReviewEvent(tx, "RECEIPT", rid, "SUBMIT", actor.userId);
      n++;
    }
  }
  await tx.trip.update({ where: { id }, data: { status: "CONFIRMED", confirmedAt: now, confirmedBy: actor.userId, cashAccountId: input.cashAccountId, transferAccountId: input.transferAccountId } });
  await writeAudit(tx, { userId: actor.userId, action: "trip.confirm_cash", entity: "Trip", entityId: id, after: { code: t.code, receipts: n, cash: t.cashAmount?.toString(), transfer: t.transferAmount?.toString() } });
  return { receipts: n };
}

/** Chỉ lưu hướng xử lý của lần giao thất bại; không đổi kho, đơn hay chuyến. */
export async function handleStop(tx: Tx, actor: Actor, stopId: number, note: string, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "trip.manage");
  const s = await tx.tripOrder.findUnique({ where: { id: stopId }, select: { result: true, handledAt: true, orderId: true } });
  if (!s || (s.result !== "KHONG_GIAO" && s.result !== "GIAO_MOT_PHAN")) throw new DomainError("Không tìm thấy hàng không giao được.", 404);
  if (s.handledAt) throw new DomainError("Đã ghi nhận xử lý trước đó.", 409);
  await tx.tripOrder.update({ where: { id: stopId }, data: { handledAt: now, handledBy: actor.userId, handledNote: note } });
  await writeAudit(tx, { userId: actor.userId, action: "trip.handle", entity: "TripOrder", entityId: stopId, after: { orderId: s.orderId, note } });
}

// ── bọc idempotency ──────────────────────────────────────────────────────────────────────────────────────────────────
const idem = <R,>(prisma: PrismaClient, actor: Actor, scope: string, key: string, run: (tx: Tx) => Promise<R>) => withIdempotency(prisma, { userId: actor.userId, scope, key }, run);
export const createTripIdempotent = (p: PrismaClient, a: Actor, key: string, i: TripInput, now: Date = new Date()) => { assertCan(a.perms, "trip.manage"); return idem(p, a, "trip.create", key, (tx) => createTrip(tx, a, i, now)); };
export const settleTripIdempotent = (p: PrismaClient, a: Actor, key: string, id: number, reason: string) => { assertCan(a.perms, "trip.settle"); return idem(p, a, "trip.settle", key, async (tx) => ({ id, ...(await settleTrip(tx, a, id, reason)) })); };
export const confirmTripCashIdempotent = (p: PrismaClient, a: Actor, key: string, id: number, i: ConfirmTripInput) => { assertCan(a.perms, "trip.confirm_cash"); return idem(p, a, "trip.confirm_cash", key, async (tx) => ({ id, ...(await confirmTripCash(tx, a, id, i)) })); };
export const recordTripResultIdempotent = (p: PrismaClient, a: Actor, key: string, id: number, i: TripResultInput, now: Date = new Date()) => { assertCan(a.perms, "trip.manage"); return idem(p, a, "trip.result", key, (tx) => recordTripResult(tx, a, id, i, now)); };
export { lineAmountOf };
