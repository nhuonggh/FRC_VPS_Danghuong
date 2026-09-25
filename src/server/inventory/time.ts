import { ictStartOfDay, toIct } from "@/lib/time";
import { parseYmd } from "@/lib/time-presets";
import { InvalidDocDateError } from "./errors";

/**
 * Thời điểm ghi sổ của chứng từ (D-7). Engine sắp sự kiện theo (at, hạng, khoá): cùng `at` thì lớp nhập THƯỜNG trước,
 * rồi lệnh xuất + lớp phụ thuộc (trả hàng/thành phẩm) theo THỨ TỰ GHI (id dòng sổ) — xem replay.ts `order`.
 *  - ngày hôm nay (ICT)  → `now` (giữ đúng thứ tự thao tác trong ngày)
 *  - ngày quá khứ        → 23:59:59.999 ICT của ngày đó (sau mọi thao tác thật của ngày; mọi chứng từ lùi về cùng ngày
 *    trùng `at` → phân định bằng hạng + thứ tự ghi như trên)
 *  - ngày tương lai      → lỗi
 * Chỉ dùng số học UTC + độ lệch ICT cố định (`@/lib/time`) → không phụ thuộc múi giờ máy chủ.
 *
 * LƯU Ý CHO NGƯỜI GỌI: kết quả KHÔNG ổn định qua các ngày. Chứng từ ngày 15/09 lập ngày 15/09 nhận `now`
 * (vd 10:30 ICT); nếu sửa ngày 20/09 rồi gọi lại `docTimestamp("2026-09-15", now=20/09)` sẽ được
 * 23:59:59.999 ICT 15/09 → thứ tự (at, id) của chứng từ bị xê dịch so với các chứng từ khác cùng ngày
 * và làm đổi kết quả FIFO. Vì vậy: khi sửa chứng từ mà NGÀY KHÔNG ĐỔI, phải dùng lại `at` đã lưu
 * (đọc từ stock_ledger trước `removeDocument`, truyền vào `postReceipt`/`postIssue`); chỉ gọi `docTimestamp`
 * cho chứng từ MỚI hoặc khi NGÀY ĐỔI.
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
