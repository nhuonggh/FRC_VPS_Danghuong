import { ictStartOfDay, toIct } from "@/lib/time";
import { parseYmd } from "@/lib/time-presets";
import { InvalidDocDateError } from "./errors";

/**
 * Thời điểm ghi sổ của chứng từ (D-7: sắp lớp/lệnh theo (at, id)).
 *  - ngày hôm nay (ICT)  → `now` (giữ đúng thứ tự thao tác trong ngày)
 *  - ngày quá khứ        → 23:59:59.999 ICT của ngày đó (sau mọi thao tác thật của ngày, tie-break bằng id)
 *  - ngày tương lai      → lỗi
 * Chỉ dùng số học UTC + độ lệch ICT cố định (`@/lib/time`) → không phụ thuộc múi giờ máy chủ.
 */
export function docTimestamp(date: string | Date, now: Date): Date {
  let day: { y: number; m: number; d: number } | null;
  if (typeof date === "string") {
    day = parseYmd(date);
  } else if (Number.isNaN(date.getTime())) {
    day = null;
  } else {
    const p = toIct(date);
    day = { y: p.y, m: p.m, d: p.d };
  }
  if (!day) throw new InvalidDocDateError("Ngày chứng từ không hợp lệ.");

  const t = toIct(now);
  const cmp = day.y - t.y || day.m - t.m || day.d - t.d;
  if (cmp > 0) throw new InvalidDocDateError("Ngày chứng từ không được ở tương lai.");
  if (cmp === 0) return now;
  return new Date(ictStartOfDay(day.y, day.m, day.d + 1).getTime() - 1);
}
