import { formatCurrency, formatNumber, formatPercent, formatQty } from "@/lib/format";
import type { DashFormat, DashTone } from "@/server/home/dashboard/types";

/** Giá trị đầy đủ theo định dạng (thẻ KPI, tooltip, bảng). */
export function fmt(value: number, format: DashFormat): string {
  switch (format) {
    case "currency": return formatCurrency(value);
    case "percent": return formatPercent(value);
    case "qty": return formatQty(value);
    case "hours": return `${formatNumber(value, 1, 0)} giờ`;
    default: return formatNumber(value);
  }
}

/** Nhãn trục gọn: 12,8 tỷ / 320 tr / 4,5 k. Chỉ để vẽ trục, không dùng để tính. */
export function compact(value: number): string {
  const a = Math.abs(value);
  if (a >= 1e9) return `${formatNumber(value / 1e9, 1, 0)} tỷ`;
  if (a >= 1e6) return `${formatNumber(value / 1e6, 1, 0)} tr`;
  if (a >= 1e4) return `${formatNumber(value / 1e3, 1, 0)} k`;
  return formatNumber(value, a < 10 ? 1 : 0, 0);
}

/** Tone → biến màu token (không hardcode hex; dark/light tự đổi). */
export const TONE_VAR: Record<DashTone, string> = {
  accent: "var(--accent-500)", success: "var(--success)", warning: "var(--warning)",
  danger: "var(--danger)", info: "var(--info)", neutral: "var(--text-muted)",
};
export const TONE_SOFT: Record<DashTone, string> = {
  accent: "bg-accent-soft text-accent", success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger", info: "bg-info-soft text-info", neutral: "bg-hover text-fg-secondary",
};

/** Màu lát donut khi loader không chỉ định tone. */
export const SLICE_VARS = ["var(--accent-500)", "var(--success)", "var(--warning)", "var(--tertiary)", "var(--info)", "var(--text-muted)"];

/** Trần "đẹp" cho trục (1, 2, 2.5, 5 × 10^k). */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}
