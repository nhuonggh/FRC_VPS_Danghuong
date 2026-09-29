import { Prisma, type DeliveryStatus, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { ictYmd } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { docTimestamp, PeriodClosedError } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import { lineAmountOf } from "@/server/sales/queries";
import type { DeliveryNoteInput } from "./schemas";

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

/** Khoá đơn (tuần tự hoá giao/sửa/hủy cùng đơn) và nạp kèm lượng đã giao còn hiệu lực theo từng dòng. */
export async function lockOrderForDelivery(tx: Tx, actor: Actor, orderId: number) {
  await tx.$queryRaw`SELECT id FROM sale_orders WHERE id = ${orderId} FOR UPDATE`;
  const order = await tx.saleOrder.findFirst({
    where: { id: orderId, partner: partnerScopeWhere(actor) },
    include: { lines: { orderBy: { id: "asc" }, include: { deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } } } } },
  });
  if (!order) throw new DomainError("Không tìm thấy đơn hàng.", 404);
  const period = await getOpenPeriod(tx);
  if (order.periodId !== period.id) throw new PeriodClosedError();
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
  const { order, period } = await lockOrderForDelivery(tx, actor, input.orderId);
  if (order.isCancelled) throw new DomainError("Đơn đã hủy, không giao được.", 409);
  const at = docTimestamp(input.date, now);
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
    await tx.partnerLedger.create({ data: { periodId: period.id, partnerId: order.partnerId, debit: value, docType: "DELIVERY", docId: id, at, createdBy: actor.userId } });
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
  const note = await tx.deliveryNote.findUnique({ where: { id }, select: { orderId: true, isCancelled: true, code: true } });
  if (!note) throw new DomainError("Không tìm thấy phiếu giao.", 404);
  const { order } = await lockOrderForDelivery(tx, actor, note.orderId);
  const fresh = await tx.deliveryNote.findUniqueOrThrow({ where: { id }, select: { isCancelled: true, periodId: true } });
  if (fresh.isCancelled) throw new DomainError("Phiếu giao đã hủy trước đó.", 409);
  await tx.deliveryNote.update({ where: { id }, data: { isCancelled: true, cancelledAt: new Date(), cancelledBy: actor.userId } });
  await tx.partnerLedger.deleteMany({ where: { docType: "DELIVERY", docId: id } });
  await syncDeliveryStatus(tx, order.id);
  await writeAudit(tx, { userId: actor.userId, action: "delivery.cancel", entity: "DeliveryNote", entityId: id, before: { code: note.code }, after: { isCancelled: true } });
}
