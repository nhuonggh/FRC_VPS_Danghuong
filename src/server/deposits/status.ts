import { Prisma, type PaymentStatus } from "@prisma/client";
import { lineAmountOf } from "@/server/sales/queries";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Các trạng thái thanh toán do CỌC quyết định. DEBT/PROMISED/PARTIAL do kết quả giao/thu tiền (plan 05) — không bị ghi đè ở đây. */
const DEPOSIT_DRIVEN: readonly PaymentStatus[] = ["UNPAID", "DEPOSITED", "PAID", "OVERPAID"];

/**
 * Tổng tiền khách đã trả cho đơn: phiếu thu còn hiệu lực (cọc + thu nợ theo đơn) + tiền lái xe đã thu ở chuyến CHƯA được thủ quỹ xác nhận
 * (sau khi xác nhận, số đó nằm ở phiếu thu nên không tính hai lần). `exceptStopId`: bỏ một điểm giao (đang nhập lại kết quả).
 */
export async function orderPaid(tx: Tx, orderId: number, exceptStopId?: number): Promise<Prisma.Decimal> {
  const [receipts, stops] = await Promise.all([
    tx.receipt.aggregate({ where: { orderId, isCancelled: false, type: { in: ["COC", "THU_NO"] } }, _sum: { amount: true } }),
    tx.tripOrder.aggregate({ where: { orderId, result: { not: null }, ...(exceptStopId ? { id: { not: exceptStopId } } : {}), trip: { status: { in: ["PLANNED", "ON_ROAD", "RETURNED", "SETTLED"] } } }, _sum: { cashAmount: true, transferAmount: true } }),
  ]);
  return (receipts._sum.amount ?? D(0)).plus(stops._sum.cashAmount ?? 0).plus(stops._sum.transferAmount ?? 0);
}

/** Đặt lại trục thanh toán theo tổng tiền thu (cọc + thu nợ theo đơn) còn hiệu lực gắn với đơn so với tiền phải thu của đơn. */
export async function syncPaymentStatus(tx: Tx, orderId: number): Promise<PaymentStatus> {
  const order = await tx.saleOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { paymentStatus: true, shippingFee: true, lines: { select: { qty: true, salePrice: true, discountNow: true } } },
  });
  const total = order.lines.reduce((s, l) => s.plus(lineAmountOf(l)), D(0)).plus(order.shippingFee);
  const paid = await orderPaid(tx, orderId);
  const current = order.paymentStatus;
  if (!DEPOSIT_DRIVEN.includes(current)) return current;
  const next: PaymentStatus = paid.eq(0) ? "UNPAID" : paid.lt(total) ? "DEPOSITED" : paid.eq(total) ? "PAID" : "OVERPAID";
  if (next !== current) await tx.saleOrder.update({ where: { id: orderId }, data: { paymentStatus: next } });
  return next;
}
