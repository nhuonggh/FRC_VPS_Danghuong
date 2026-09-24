import { ApiError, SessionExpiredError } from "./api-fetch";
import { toast } from "./toast";

/**
 * Hiện lỗi của một thao tác gọi API dưới dạng toast (thao tác không nằm trong form/section có banner riêng).
 * 401: `apiFetch` đã hiện toast "phiên hết hạn" không tự tắt → không thêm toast thứ hai.
 * Lỗi không phải ApiError (bug/JS lỗi) → thông báo chung, không lộ thông điệp kỹ thuật.
 */
export function toastApiError(e: unknown, fallback = "Không thực hiện được, vui lòng thử lại."): void {
  if (e instanceof SessionExpiredError) return;
  toast.error(e instanceof ApiError ? e.message : fallback);
}
