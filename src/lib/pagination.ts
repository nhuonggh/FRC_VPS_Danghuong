export const PAGE_SIZES = [10, 15, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

/** Dãy số trang hiển thị: 1 … 11 12 13 … 25. */
export function pageWindow(current: number, total: number): (number | "…")[] {
  const last = Math.max(1, total);
  if (last <= 5) return Array.from({ length: last }, (_, i) => i + 1);
  const keep = new Set([1, last, current - 1, current, current + 1].filter((p) => p >= 1 && p <= last));
  // trang 1 kéo theo 2, 3 → "1 2 3 … 25" (crm-design); trang cuối chỉ cần ±1 → "1 … 24 25"
  if (current <= 1) [2, 3].forEach((p) => keep.add(p));
  const pages = [...keep].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1]! > 1) out.push("…");
    out.push(p);
  });
  return out;
}

/** Vòng sort khi click header: tăng → giảm (tiền tố '-') → bỏ sort. */
export function nextSort(current: string | undefined, key: string): string | undefined {
  if (current === key) return `-${key}`;
  if (current === `-${key}`) return undefined;
  return key;
}
