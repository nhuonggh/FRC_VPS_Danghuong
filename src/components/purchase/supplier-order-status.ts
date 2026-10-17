import type { BadgeTone } from "@/components/ui/Badge";
export const ORDER_STATUSES: Record<string, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Nháp", tone: "neutral" }, SENT: { label: "Đã đặt – chờ nhận", tone: "warning" },
  PARTIAL: { label: "Đã nhận một phần", tone: "info" }, RECEIVED: { label: "Đã nhận đủ", tone: "success" },
  CLOSED: { label: "Đã đóng – còn thiếu", tone: "neutral" }, CANCELLED: { label: "Đã hủy", tone: "danger" },
};
