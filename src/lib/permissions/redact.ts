import { SENSITIVE_FIELDS, type PermissionCode } from "./catalog";

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Trả bản sao đã BỎ key nhạy cảm ở mọi tầng (object thường + mảng, kể cả mảng trong mảng).
 * Không đi vào Decimal/Date/class instance; null/undefined/nguyên thuỷ trả nguyên.
 * Dùng ở cuối mọi hàm trả DTO ra client (T2).
 */
export function redactDeep<T>(
  value: T,
  perms: ReadonlySet<string>,
  sensitive: Record<string, PermissionCode> = SENSITIVE_FIELDS,
): T {
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, perms, sensitive)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const need = Object.hasOwn(sensitive, k) ? sensitive[k] : undefined;
      if (need && !perms.has(need)) continue;
      out[k] = redactDeep(v, perms, sensitive);
    }
    return out as T;
  }
  return value;
}
