import { formatDateTime, formatNumber, NULL_TEXT } from "./format";

/** Giá trị hiển thị tối đa cho 1 ô số cũ/số mới (payload lớn không được làm vỡ trang hay phình DTO). */
export const AUDIT_VALUE_MAX_CHARS = 2000;
/** Số dòng "số cũ / số mới" tối đa gửi xuống client cho 1 bản ghi (payload cực lớn không được làm phình DTO). */
export const MAX_CHANGES = 300;

/** DTO trang chi tiết nhật ký: đã lọc theo quyền người xem và định dạng sẵn — KHÔNG chứa JSON thô. */
export interface AuditDetailDto {
  id: number;
  at: string;
  by: string;
  action: string;
  entity: string;
  entityId: string | null;
  ip: string | null;
  changes: { path: string; before: string; after: string }[];
  /** Có field bị ẩn vì người xem thiếu quyền (cost/profit/giá…). */
  hiddenByPermission: boolean;
  /** Có hơn MAX_CHANGES thay đổi, danh sách đã rút gọn. */
  truncated: boolean;
}

// Chuỗi Decimal của Prisma có phần lẻ: "1500000.5000". Chuỗi số nguyên ("00123", mã vạch, SĐT) KHÔNG đụng vào: có thể là mã.
const DECIMAL_STRING = /^-?\d+\.\d+$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function truncateText(s: string, max = AUDIT_VALUE_MAX_CHARS): string {
  if (s.length <= max) return s;
  let end = max;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end -= 1; // không cắt đôi cặp thay thế (emoji)
  return `${s.slice(0, end)}…`;
}

/**
 * Định dạng 1 giá trị JSON của nhật ký để HIỂN THỊ (số cũ / số mới): vắng mặt/null → "—", số & chuỗi Decimal theo
 * `@/lib/format` (vi-VN), ISO datetime → giờ ICT, boolean → Có/Không, object/mảng → JSON gọn. Luôn cắt ≤ AUDIT_VALUE_MAX_CHARS.
 */
export function formatAuditValue(v: unknown): string {
  if (v === undefined || v === null) return NULL_TEXT;
  if (typeof v === "number") return formatNumber(v, 6);
  if (typeof v === "boolean") return v ? "Có" : "Không";
  if (typeof v === "string") {
    if (DECIMAL_STRING.test(v)) return formatNumber(v, 6);
    if (ISO_DATETIME.test(v)) return formatDateTime(v);
    return truncateText(v);
  }
  return truncateText(JSON.stringify(v) ?? NULL_TEXT);
}
