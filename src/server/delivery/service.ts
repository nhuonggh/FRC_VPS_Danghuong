import { Prisma, type DeliveryStatus, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { ictYmd } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { docTimestamp, PeriodClosedError } from "@/server/inventory";
import { assertDocDateInPeriod, getOpenPeriod } from "@/server/period/guard";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import { lineAmountOf } from "@/server/sales/queries";
import type { DeliveryNoteInput } from "./schemas";
import { postPartnerLedger, removePartnerLedger } from "@/server/debt/ledger";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * Giá trị ghi công nợ cho phần giao: theo tỷ lệ số lượng trên thành tiền dòng (sau chiết khấu trừ ngay). Làm tròn
 * THEO LUỸ KẾ (round(net × luỹ kế mới / SL dòng) − round(net × luỹ kế cũ / SL dòng)) nên Σ mọi lần giao đúng bằng
 * thành tiền dòng, không lệch vài đồng do làm tròn từng lần.
 */
export function deliveredValue(net: Prisma.Decimal, lineQty: Prisma.Decimal, cumBefore: Prisma.Decimal, qtyNow: Prisma.Decimal): Prisma.Decimal {
  const at = (cum: Prisma.Decimal) => round2(net.times(cum).div(lineQty));
  return at(cumBefore.plus(qtyNow)).minus(at(cumBefore));
}

/**
 * Khoá đơn (tuần tự hoá giao/sửa/hủy cùng đơn) và nạp kèm lượng đã giao còn hiệu lực theo từng dòng.
 * Mặc định đơn phải thuộc KỲ ĐANG MỞ (sửa/hủy/xác nhận đơn là thao tác lên chứng từ gốc). `allowClosedPeriod`: cho đơn của kỳ đã
 * kết sổ — dùng cho chứng từ MỚI sinh ở kỳ mở liên quan đơn cũ (giao nốt, thu cọc; spec 4.4, Plan 07 F1d). Chứng từ mới tự mang
 * kỳ đang mở nên không đụng sổ kỳ cũ; kho đã xuất lúc xác nhận đơn (D-25) nên không đụng FIFO.
 */
export async function lockOrderForDelivery(tx: Tx, actor: Actor, orderId: number, opts: { allowClosedPeriod?: boolean } = {}) {
  await tx.$queryRaw`SELECT id FROM sale_orders WHERE id = ${orderId} FOR UPDATE`;
  const order = await tx.saleOrder.findFirst({
    where: { id: orderId, partner: partnerScopeWhere(actor) },
    include: { lines: { orderBy: { id: "asc" }, include: { deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } } } } },
  });
  if (!order) throw new DomainError("Không tìm thấy đơn hàng.", 404);
  const period = await getOpenPeriod(tx);
  if (!opts.allowClosedPeriod && order.periodId !== period.id) throw new PeriodClosedError();
  return { order, period };
}

const deliveredOf = (line: { deliveryLines: { qty: Prisma.Decimal }[] }) => line.deliveryLines.reduce((s, d) => s.plus(d.qty), D(0));

/** Đặt lại trục giao hàng theo tổng đã giao. Chỉ đụng NEW/PARTIAL/DELIVERED (các bước xếp xe/đi đường thuộc plan 05). */
export async function syncDeliveryStatus(tx: Tx, orderId: number): Promise<DeliveryStatus> {
  const order = await tx.saleOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { deliveryStatus: true, lines: { select: { qty: true, deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } } } } },
  });
  const total = order.lines.reduce((s, l) => s.plus(l.qty), D(0));
  const done = order.lines.reduce((s, l) => s.plus(deliveredOf(l)), D(0));
  const cur = order.deliveryStatus;
  const next: DeliveryStatus = done.gte(total) && total.gt(0) ? "DELIVERED" : done.gt(0) ? "PARTIAL" : cur === "PARTIAL" || cur === "DELIVERED" ? "NEW" : cur;
  if (next !== cur) await tx.saleOrder.update({ where: { id: orderId }, data: { deliveryStatus: next } });
  return next;
}

export async function createDeliveryNote(tx: Tx, actor: Actor, input: DeliveryNoteInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertCan(actor.perms, "order.edit");
  return createDeliveryNoteCore(tx, actor, input, now);
}

/** Lõi tạo phiếu giao KHÔNG kiểm quyền: người gọi (vd nhập kết quả chuyến giao — quyền trip.manage) tự kiểm quyền của mình. */
export async function createDeliveryNoteCore(tx: Tx, actor: Actor, input: DeliveryNoteInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  const { order, period } = await lockOrderForDelivery(tx, actor, input.orderId, { allowClosedPeriod: true });
  if (order.isCancelled) throw new DomainError("Đơn đã hủy, không giao được.", 409);
  if (order.isDraft) throw new DomainError("Đơn nháp chưa xác nhận (chưa xuất kho), chưa giao được.", 409);
  const at = docTimestamp(input.date, now);
  assertDocDateInPeriod(period, at); // phiếu giao mới không được lùi ngày vào kỳ đã đóng
  if (ictYmd(at) < ictYmd(order.orderDate)) throw new DomainError("Ngày giao không được trước ngày đơn.", 400);

  const byId = new Map(order.lines.map((l) => [l.id, l]));
  let value = D(0);
  const rows = input.lines.map((l, i) => {
    const line = byId.get(l.orderLineId);
    if (!line) throw new DomainError(`Dòng ${i + 1}: không thuộc đơn này.`, 400);
    const delivered = deliveredOf(line);
    const remaining = line.qty.minus(delivered);
    if (D(l.qty).gt(remaining)) throw new DomainError(`Dòng ${i + 1}: chỉ còn ${remaining.toString()} ${line.unit} chưa giao.`, 400);
    value = value.plus(deliveredValue(lineAmountOf(line), line.qty, delivered, D(l.qty)));
    return { orderLineId: line.id, qty: D(l.qty) };
  });

  const id = await nextDocId(tx, "delivery_notes");
  const code = formatDocCode("PG", id);
  await tx.deliveryNote.create({
    data: { id, code, periodId: period.id, orderId: order.id, at, note: input.note || null, createdBy: actor.userId, lines: { create: rows } },
  });
  // D-26: công nợ ghi khi GIAO. Khách nợ mình → debit.
  if (value.gt(0)) {
    await postPartnerLedger(tx, { periodId: period.id, partnerId: order.partnerId, side: "debit", amount: value, docType: "DELIVERY", docId: id, at, createdBy: actor.userId });
  }
  await syncDeliveryStatus(tx, order.id);
  await writeAudit(tx, { userId: actor.userId, action: "delivery.create", entity: "DeliveryNote", entityId: id, after: { code, orderCode: order.code, lineCount: rows.length } });
  return { id, code };
}

export async function createDeliveryNoteIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: DeliveryNoteInput, now: Date = new Date()) {
  assertCan(actor.perms, "order.edit");
  return withIdempotency(prisma, { userId: actor.userId, scope: "delivery.create", key }, (tx) => createDeliveryNote(tx, actor, input, now));
}

/** Hủy phiếu giao: đảo công nợ (xoá dòng sổ của phiếu, như phiếu nhập) và trả trạng thái giao về đúng. */
export async function cancelDeliveryNote(tx: Tx, actor: Actor, id: number): Promise<void> {
  assertCan(actor.perms, "order.edit");
  return cancelDeliveryNoteCore(tx, actor, id);
}

/** Lõi hủy phiếu giao KHÔNG kiểm quyền (xem createDeliveryNoteCore). */
export async function cancelDeliveryNoteCore(tx: Tx, actor: Actor, id: number): Promise<void> {
  const note = await tx.deliveryNote.findUnique({ where: { id }, select: { orderId: true, isCancelled: true, code: true } });
  if (!note) throw new DomainError("Không tìm thấy phiếu giao.", 404);
  const { order, period } = await lockOrderForDelivery(tx, actor, note.orderId, { allowClosedPeriod: true });
  const fresh = await tx.deliveryNote.findUniqueOrThrow({ where: { id }, select: { isCancelled: true, periodId: true } });
  // Quy tắc theo kỳ của PHIẾU giao (không phải kỳ của đơn): phiếu giao nốt ở kỳ mở hủy được, phiếu của kỳ đã đóng thì không
  if (fresh.periodId !== period.id) throw new PeriodClosedError();
  if (fresh.isCancelled) throw new DomainError("Phiếu giao đã hủy trước đó.", 409);
  // Không để tổng đã giao thấp hơn tổng đã trả: hủy phiếu trả hàng trước
  const returned = await tx.goodsReturnLine.groupBy({ by: ["orderLineId"], where: { goodsReturn: { orderId: order.id, isCancelled: false } }, _sum: { qty: true } });
  if (returned.length) {
    const noteLines = await tx.deliveryLine.findMany({ where: { deliveryNoteId: id }, select: { orderLineId: true, qty: true } });
    for (const r of returned) {
      const line = order.lines.find((l) => l.id === r.orderLineId);
      const removing = noteLines.filter((n) => n.orderLineId === r.orderLineId).reduce((s, n) => s.plus(n.qty), D(0));
      if (line && removing.gt(0) && deliveredOf(line).minus(removing).lt(r._sum.qty ?? 0)) {
        throw new DomainError("Hàng của phiếu giao này đã được khách trả lại. Hãy hủy phiếu trả hàng trước khi hủy phiếu giao.", 409, "HAS_RETURN");
      }
    }
  }
  await tx.deliveryNote.update({ where: { id }, data: { isCancelled: true, cancelledAt: new Date(), cancelledBy: actor.userId } });
  await removePartnerLedger(tx, "DELIVERY", id);
  await syncDeliveryStatus(tx, order.id);
  await writeAudit(tx, { userId: actor.userId, action: "delivery.cancel", entity: "DeliveryNote", entityId: id, before: { code: note.code }, after: { isCancelled: true } });
}

/**
 * Ghi lại công nợ của MỌI phiếu giao còn hiệu lực theo thành tiền/SL dòng HIỆN TẠI (sau khi sửa đơn đã giao một phần).
 * Duyệt phiếu theo thứ tự thời gian, cộng dồn SL từng dòng — cùng công thức làm tròn luỹ kế lúc tạo phiếu.
 */
export async function rewriteDeliveryLedger(tx: Tx, actor: Actor, orderId: number): Promise<void> {
  const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
  const notes = await tx.deliveryNote.findMany({ where: { orderId, isCancelled: false }, orderBy: [{ at: "asc" }, { id: "asc" }], include: { lines: true } });
  const lineById = new Map(order.lines.map((l) => [l.id, l]));
  const cum = new Map<number, Prisma.Decimal>();
  for (const note of notes) {
    let value = D(0);
    for (const dl of note.lines) {
      const line = lineById.get(dl.orderLineId)!;
      const before = cum.get(line.id) ?? D(0);
      value = value.plus(deliveredValue(lineAmountOf(line), line.qty, before, dl.qty));
      cum.set(line.id, before.plus(dl.qty));
    }
    await removePartnerLedger(tx, "DELIVERY", note.id);
    if (value.gt(0)) {
      await postPartnerLedger(tx, { periodId: note.periodId, partnerId: order.partnerId, side: "debit", amount: value, docType: "DELIVERY", docId: note.id, at: note.at, createdBy: actor.userId });
    }
  }
}
