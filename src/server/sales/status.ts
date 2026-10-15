import type { DeliveryStatus, PaymentStatus } from "@prisma/client";
import { ictYmd } from "@/lib/time";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const DELIVERY_LABEL: Record<DeliveryStatus, { label: string; tone: Tone }> = {
  NEW: { label: "Mới tạo", tone: "neutral" },
  WAITING_STOCK: { label: "Chưa đủ tồn", tone: "warning" },
  READY: { label: "Sẵn hàng", tone: "info" },
  LOADED: { label: "Đã xếp xe", tone: "info" },
  DELIVERING: { label: "Đang giao", tone: "info" },
  DELIVERED: { label: "Đã giao", tone: "success" },
  PARTIAL: { label: "Giao một phần", tone: "warning" },
  FAILED: { label: "Không giao được", tone: "danger" },
};

export const PAYMENT_LABEL: Record<PaymentStatus, { label: string; tone: Tone }> = {
  UNPAID: { label: "Chưa thu", tone: "neutral" },
  DEPOSITED: { label: "Đã cọc", tone: "info" },
  PARTIAL: { label: "Thu một phần", tone: "warning" },
  PAID: { label: "Đã thanh toán", tone: "success" },
  DEBT: { label: "Nợ ghi sổ", tone: "warning" },
  PROMISED: { label: "Hẹn đơn sau trả", tone: "warning" },
  OVERPAID: { label: "Dư tiền", tone: "info" },
};

/**
 * Trục giao hàng hiển thị. Đơn mới xuất kho ngay (D-25) nên "Mới tạo" chưa dùng phiếu giao/chuyến được suy ra từ tồn:
 * còn dòng treo (bán âm kho) → "Chưa đủ tồn"; đủ tồn → "Sẵn hàng". Các trạng thái sau do phiếu giao/chuyến đặt (C3, plan 05).
 */
export function effectiveDeliveryStatus(stored: DeliveryStatus, hasProvisional: boolean): DeliveryStatus {
  if (stored !== "NEW") return stored;
  return hasProvisional ? "WAITING_STOCK" : "READY";
}

const FINISHED: readonly DeliveryStatus[] = ["DELIVERED", "FAILED"];
export const isFinishedDelivery = (s: DeliveryStatus) => FINISHED.includes(s);

/** Số ngày trễ so với ngày giao GỐC (`originalDeliveryDate`), theo lịch ICT; 0 nếu chưa trễ/đã xong/đã hủy. */
export function delayDays(order: { originalDeliveryDate: Date; deliveryStatus: DeliveryStatus; isCancelled: boolean }, now: Date): number {
  if (order.isCancelled || isFinishedDelivery(order.deliveryStatus)) return 0;
  const today = Date.parse(`${ictYmd(now)}T00:00:00Z`);
  return Math.max(0, Math.round((today - order.originalDeliveryDate.getTime()) / 86_400_000));
}
