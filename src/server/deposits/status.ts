import { Prisma, type PaymentStatus } from "@prisma/client";
import { lineAmountOf } from "@/server/sales/queries";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Các trạng thái thanh toán do CỌC quyết định. DEBT/PROMISED/PARTIAL do kết quả giao/thu tiền (plan 05) — không bị ghi đè ở đây. */
const DEPOSIT_DRIVEN: readonly PaymentStatus[] = ["UNPAID", "DEPOSITED", "PAID", "OVERPAID"];

/** Đặt lại trục thanh toán theo tổng cọc còn hiệu lực gắn với đơn so với tiền phải thu của đơn. */
export async function syncPaymentStatus(tx: Tx, orderId: number): Promise<PaymentStatus> {
  const order = await tx.saleOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { paymentStatus: true, lines: { select: { qty: true, salePrice: true, discountNow: true } } },
  });
  const total = order.lines.reduce((s, l) => s.plus(lineAmountOf(l)), D(0));
  const paid = (await tx.receipt.aggregate({ where: { orderId, isCancelled: false, type: "COC" }, _sum: { amount: true } }))._sum.amount ?? D(0);
  const current = order.paymentStatus;
  if (!DEPOSIT_DRIVEN.includes(current)) return current;
  const next: PaymentStatus = paid.eq(0) ? "UNPAID" : paid.lt(total) ? "DEPOSITED" : paid.eq(total) ? "PAID" : "OVERPAID";
  if (next !== current) await tx.saleOrder.update({ where: { id: orderId }, data: { paymentStatus: next } });
  return next;
}
