import type { CashReviewStatus } from "@prisma/client";

/** Nhãn thuần (không import module server) — component client dùng được. */
export const REVIEW_LABEL: Record<CashReviewStatus | "CANCELLED", string> = { PENDING_REVIEW: "Chờ kiểm tra", REVIEWED: "Đã kiểm tra", RETURNED: "Bị trả lại", CANCELLED: "Đã hủy" };
export const EVENT_LABEL: Record<string, string> = { SUBMIT: "Lập phiếu", EDIT: "Sửa phiếu", RESUBMIT: "Sửa & gửi lại", REVIEW: "Thủ quỹ kiểm tra", RETURN: "Thủ quỹ trả lại", CANCEL: "Hủy phiếu" };
