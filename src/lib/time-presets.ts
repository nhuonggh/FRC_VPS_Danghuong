import { ictStartOfDay, toIct } from "./time";

export type TimePreset =
  | "today" | "thisWeek" | "thisMonth" | "thisQuarter"
  | "lastWeek" | "lastMonth" | "lastQuarter" | "thisYear" | "lastYear" | "custom";

// Đủ 10 mốc cố định (view-table.md mục 2) — luôn dùng nguyên bộ, không lắp rời từng module
export const TIME_PRESETS: { value: TimePreset; label: string }[] = [
  { value: "today", label: "Hôm nay" },
  { value: "thisWeek", label: "Tuần này" },
  { value: "thisMonth", label: "Tháng này" },
  { value: "thisQuarter", label: "Quý này" },
  { value: "lastWeek", label: "Tuần trước" },
  { value: "lastMonth", label: "Tháng trước" },
  { value: "lastQuarter", label: "Quý trước" },
  { value: "thisYear", label: "Năm nay" },
  { value: "lastYear", label: "Năm trước" },
  { value: "custom", label: "Tùy chọn" },
];

export interface TimeRange {
  start: Date; // gồm
  end: Date; // KHÔNG gồm
}

/** 'yyyy-mm-dd' → {y, m (0–11), d}; ngày không tồn tại (30/02) → null. Engine kho dùng lại hàm này. */
export function parseYmd(s: string | undefined): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const y = +m[1]!, mo = +m[2]! - 1, d = +m[3]!;
  const probe = new Date(Date.UTC(y, mo, d));
  // loại ngày không tồn tại (30/02)
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo || probe.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/**
 * Khoảng thời gian nửa mở [start, end) theo giờ Asia/Ho_Chi_Minh (không phụ thuộc múi giờ máy); tuần bắt đầu Thứ Hai.
 * `custom` thiếu/sai định dạng/ngày không tồn tại/kết thúc trước bắt đầu → null (người gọi coi như KHÔNG lọc thời gian).
 * Ngày kết thúc của `custom` được tính GỒM (end = 0h ICT ngày kế tiếp).
 */
export function resolveTimeRange(
  preset: TimePreset,
  now: Date,
  custom?: { start?: string; end?: string },
): TimeRange | null {
  const t = toIct(now);
  const day = (y: number, m: number, d: number) => ictStartOfDay(y, m, d);
  switch (preset) {
    case "today":
      return { start: day(t.y, t.m, t.d), end: day(t.y, t.m, t.d + 1) };
    case "thisWeek": {
      const monday = t.d - t.dow;
      return { start: day(t.y, t.m, monday), end: day(t.y, t.m, monday + 7) };
    }
    case "lastWeek": {
      const monday = t.d - t.dow - 7;
      return { start: day(t.y, t.m, monday), end: day(t.y, t.m, monday + 7) };
    }
    case "thisMonth":
      return { start: day(t.y, t.m, 1), end: day(t.y, t.m + 1, 1) };
    case "lastMonth":
      return { start: day(t.y, t.m - 1, 1), end: day(t.y, t.m, 1) };
    case "thisQuarter": {
      const q = Math.floor(t.m / 3) * 3;
      return { start: day(t.y, q, 1), end: day(t.y, q + 3, 1) };
    }
    case "lastQuarter": {
      const q = Math.floor(t.m / 3) * 3;
      return { start: day(t.y, q - 3, 1), end: day(t.y, q, 1) };
    }
    case "thisYear":
      return { start: day(t.y, 0, 1), end: day(t.y + 1, 0, 1) };
    case "lastYear":
      return { start: day(t.y - 1, 0, 1), end: day(t.y, 0, 1) };
    case "custom": {
      const s = parseYmd(custom?.start);
      const e = parseYmd(custom?.end);
      if (!s || !e) return null;
      const start = day(s.y, s.m, s.d);
      const end = day(e.y, e.m, e.d + 1); // gồm cả ngày kết thúc
      return end > start ? { start, end } : null;
    }
  }
}

/** Where-clause Prisma cho cột ngày: nửa mở (gte/lt), KHÔNG dùng lte để bản ghi đúng 0h ngày kế không lọt vào. */
export const timeRangeWhere = (range: TimeRange) => ({ gte: range.start, lt: range.end });
