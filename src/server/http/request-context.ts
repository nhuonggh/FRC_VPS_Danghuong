import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Ngữ cảnh của request API đang xử lý (đặt bởi `apiHandler`), đọc được ở tầng service mà không phải truyền tay qua mọi
 * hàm — hiện dùng cho IP trong nhật ký (writeAudit). Ngoài request (seed, worker nền, test gọi service trực tiếp) ⇒ rỗng.
 */
export interface RequestContext {
  ip: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentRequestIp(): string | null {
  return storage.getStore()?.ip ?? null;
}

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+(?:%[0-9a-z]+)?$/i;

function normalizeIp(raw: string | null | undefined): string | null {
  let v = raw?.trim();
  if (!v) return null;
  if (v.startsWith("[")) v = v.slice(1, v.indexOf("]") > 0 ? v.indexOf("]") : undefined); // [::1]:1234
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":")); // 1.2.3.4:5678
  if (v.toLowerCase().startsWith("::ffff:") && IPV4.test(v.slice(7))) v = v.slice(7);
  if (v.length > 45) return null;
  return IPV4.test(v) || (v.includes(":") && IPV6.test(v)) ? v : null;
}

/**
 * IP máy khách: hop ĐẦU của `X-Forwarded-For`, không có thì `X-Real-IP`. Chỉ đáng tin khi app đứng SAU reverse proxy
 * (Caddy) ghi đè header này — chạy trần (dev) thì client tự đặt được. Giá trị không phải IP hợp lệ ⇒ null (không ghi
 * chuỗi tuỳ ý của client vào audit_log append-only).
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) return normalizeIp(xff.split(",")[0]);
  return normalizeIp(headers.get("x-real-ip"));
}
