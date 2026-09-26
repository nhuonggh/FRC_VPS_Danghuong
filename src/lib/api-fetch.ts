import { toast, useToastStore } from "./toast";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    /** Lỗi theo field từ server (400 ValidationError, 409 FieldConflictError) — form hiện ngay tại ô. */
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export class SessionExpiredError extends ApiError {
  constructor() {
    super(401, "Phiên đăng nhập đã hết hạn.");
    this.name = "SessionExpiredError";
  }
}

const SESSION_EXPIRED_TOAST =
  "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại ở tab mới — dữ liệu đang nhập vẫn được giữ trên màn hình này.";

type Init = Omit<RequestInit, "body"> & { json?: unknown; idempotencyKey?: string; body?: BodyInit | null };

/**
 * fetch cho client: JSON hai chiều, thông báo lỗi tiếng Việt, gắn Idempotency-Key.
 * 401 KHÔNG redirect: hiện toast lỗi (không tự tắt) và ném SessionExpiredError → form giữ nguyên dữ liệu đang nhập;
 * người dùng đăng nhập lại ở tab khác rồi bấm Lưu lại.
 */
export async function apiFetch<T = unknown>(url: string, init: Init = {}): Promise<T> {
  const { json, idempotencyKey, ...rest } = init;
  const headers = new Headers(init.headers);
  if (json !== undefined) headers.set("content-type", "application/json");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);

  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : init.body });
  } catch {
    throw new ApiError(0, "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại — dữ liệu đang nhập vẫn được giữ.");
  }

  if (res.status === 401) {
    // Toast lỗi không tự tắt → nhiều request cùng dính 401 không được chồng nhiều toast giống nhau
    if (!useToastStore.getState().items.some((i) => i.message === SESSION_EXPIRED_TOAST)) toast.error(SESSION_EXPIRED_TOAST);
    throw new SessionExpiredError();
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; fields?: Record<string, string> };
    throw new ApiError(res.status, data.error ?? "Có lỗi xảy ra, vui lòng thử lại.", data.code, data.fields);
  }
  return (await res.json().catch(() => ({}))) as T;
}
