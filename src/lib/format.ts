import { toIct } from "./time";

export const NULL_TEXT = "—";

type Numeric = number | string | { toString(): string } | null | undefined;

const isBlank = (v: Numeric) => v === null || v === undefined || v === "";

const group = (intPart: string) => intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Chỉ để HIỂN THỊ (không dùng để tính). `null/undefined/""` → "—"; số 0 → "0".
 * maxFrac/minFrac: số chữ số thập phân tối đa/tối thiểu.
 */
export function formatNumber(v: Numeric, maxFrac = 0, minFrac = 0): string {
  if (isBlank(v)) return NULL_TEXT;
  const n = Number(String(v));
  if (!Number.isFinite(n)) return NULL_TEXT;
  const fixed = Math.abs(n).toFixed(maxFrac);
  const [int, fracRaw = ""] = fixed.split(".") as [string, string?];
  let frac = fracRaw;
  while (frac.length > minFrac && frac.endsWith("0")) frac = frac.slice(0, -1);
  const negative = n < 0 && /[1-9]/.test(fixed);
  return `${negative ? "-" : ""}${group(int)}${frac ? "," + frac : ""}`;
}

/** Số lượng: tối đa 3 số lẻ, bỏ số 0 thừa. */
export const formatQty = (v: Numeric) => formatNumber(v, 3, 0);

export function formatCurrency(v: Numeric): string {
  if (isBlank(v)) return NULL_TEXT;
  const s = formatNumber(v, 0, 0);
  return s === NULL_TEXT ? s : `${s} ₫`;
}

/** v là tỷ lệ theo phần trăm (12.5 → "12,5%"). Chưa có dữ liệu (null) → "—", KHÔNG phải "0%". */
export function formatPercent(v: Numeric, maxFrac = 1): string {
  if (isBlank(v)) return NULL_TEXT;
  const s = formatNumber(v, maxFrac, 0);
  return s === NULL_TEXT ? s : `${s}%`;
}

const p2 = (n: number) => String(n).padStart(2, "0");

function toDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(v: Date | string | null | undefined): string {
  const d = toDate(v);
  if (!d) return NULL_TEXT;
  const t = toIct(d);
  return `${p2(t.d)}/${p2(t.m + 1)}/${t.y}`;
}

export function formatDateTime(v: Date | string | null | undefined): string {
  const d = toDate(v);
  if (!d) return NULL_TEXT;
  const t = toIct(d);
  return `${p2(t.hh)}:${p2(t.mm)} ${p2(t.d)}/${p2(t.m + 1)}/${t.y}`;
}
