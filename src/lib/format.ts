import { toIct } from "./time";

export const NULL_TEXT = "—";

type Numeric = number | string | { toString(): string } | null | undefined;

const isBlank = (v: Numeric) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

const group = (intPart: string) => intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i;

interface Decimal10 {
  negative: boolean;
  int: string; // chỉ chữ số, không zero đầu thừa
  frac: string; // chỉ chữ số
}

/** Tách chuỗi thập phân (kể cả dạng mũ "1e+21") thành phần nguyên/lẻ mà KHÔNG đi qua số thực nhị phân. */
function parseDecimal(input: string): Decimal10 | null {
  const m = DECIMAL_RE.exec(input.trim());
  if (!m) return null;
  const [, sign = "", intRaw = "", fracRaw = "", expRaw] = m;
  if (intRaw === "" && fracRaw === "") return null;
  const digits = intRaw + fracRaw;
  const point = intRaw.length + (expRaw ? Number(expRaw) : 0);
  let int: string;
  let frac: string;
  if (point <= 0) {
    int = "0";
    frac = "0".repeat(-point) + digits;
  } else if (point >= digits.length) {
    int = digits + "0".repeat(point - digits.length);
    frac = "";
  } else {
    int = digits.slice(0, point);
    frac = digits.slice(point);
  }
  return { negative: sign === "-", int: int.replace(/^0+(?=\d)/, ""), frac };
}

/** Cộng 1 đơn vị ở chữ số cuối của chuỗi chữ số (giữ nguyên độ dài, có thể dài thêm 1 khi tràn). */
function incrementDigits(d: string): string {
  const out = d.split("");
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === "9") out[i] = "0";
    else {
      out[i] = String(Number(out[i]) + 1);
      return out.join("");
    }
  }
  return "1" + out.join("");
}

/**
 * Chỉ để HIỂN THỊ (không dùng để tính). `null/undefined/""/khoảng trắng/NaN` → "—"; số 0 → "0".
 * maxFrac/minFrac: số chữ số thập phân tối đa/tối thiểu (minFrac > maxFrac thì maxFrac được nâng lên).
 * Làm tròn half-up (ra xa số 0) trên CHUỖI THẬP PHÂN — khớp NUMERIC của Postgres, đúng với
 * Prisma.Decimal/chuỗi và không mất chữ số với số lớn (không dùng toFixed của số thực nhị phân).
 */
export function formatNumber(v: Numeric, maxFrac = 0, minFrac = 0): string {
  if (isBlank(v)) return NULL_TEXT;
  const parsed = parseDecimal(String(v));
  if (!parsed) return NULL_TEXT;
  const max = Math.max(maxFrac, minFrac);

  let int = parsed.int;
  let frac = parsed.frac;
  if (frac.length > max) {
    const roundUp = frac.charCodeAt(max) >= 53; // chữ số bị cắt >= '5'
    frac = frac.slice(0, max);
    if (roundUp) {
      const carried = incrementDigits(int + frac);
      int = carried.slice(0, carried.length - max);
      frac = carried.slice(carried.length - max);
    }
  }
  while (frac.length > minFrac && frac.endsWith("0")) frac = frac.slice(0, -1);
  frac = frac.padEnd(minFrac, "0");

  const isZero = !/[1-9]/.test(int + frac);
  return `${parsed.negative && !isZero ? "-" : ""}${group(int)}${frac ? "," + frac : ""}`;
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
