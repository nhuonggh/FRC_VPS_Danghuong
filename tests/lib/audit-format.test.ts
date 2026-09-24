import { describe, expect, it } from "vitest";
import { AUDIT_VALUE_MAX_CHARS, formatAuditValue } from "@/lib/audit-format";

describe("formatAuditValue — hiển thị số cũ / số mới", () => {
  it("vắng mặt / null → '—' (không phải 'null'/'undefined'/0)", () => {
    expect(formatAuditValue(undefined)).toBe("—");
    expect(formatAuditValue(null)).toBe("—");
  });

  it("số → định dạng vi-VN qua @/lib/format; 0 vẫn là '0'", () => {
    expect(formatAuditValue(1500000)).toBe("1.500.000");
    expect(formatAuditValue(12.5)).toBe("12,5");
    expect(formatAuditValue(0)).toBe("0");
    expect(formatAuditValue(-3)).toBe("-3");
  });

  it("chuỗi Decimal (có phần lẻ) → định dạng số; chuỗi số nguyên/mã giữ nguyên (không mất số 0 đầu)", () => {
    expect(formatAuditValue("1500000.5000")).toBe("1.500.000,5");
    expect(formatAuditValue("0.25")).toBe("0,25");
    expect(formatAuditValue("00123")).toBe("00123");
    expect(formatAuditValue("0912345678")).toBe("0912345678");
  });

  it("chuỗi ngày ISO → giờ ICT dd/mm/yyyy", () => {
    expect(formatAuditValue("2026-09-30T16:50:00.000Z")).toBe("23:50 30/09/2026");
    expect(formatAuditValue("2026-09-30T17:00:00Z")).toBe("00:00 01/10/2026");
  });

  it("boolean → Có / Không; chuỗi thường giữ nguyên; chuỗi rỗng → ''", () => {
    expect(formatAuditValue(true)).toBe("Có");
    expect(formatAuditValue(false)).toBe("Không");
    expect(formatAuditValue("Nguyễn Văn Nam")).toBe("Nguyễn Văn Nam");
    expect(formatAuditValue("")).toBe("");
  });

  it("mảng/object → JSON gọn", () => {
    expect(formatAuditValue(["A", "B"])).toBe('["A","B"]');
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
  });

  it("payload lớn bị cắt an toàn, có dấu '…', không vượt giới hạn", () => {
    const big = "x".repeat(AUDIT_VALUE_MAX_CHARS * 3);
    const out = formatAuditValue(big);
    expect(out.length).toBeLessThanOrEqual(AUDIT_VALUE_MAX_CHARS + 1);
    expect(out.endsWith("…")).toBe(true);
    const arr = formatAuditValue(Array.from({ length: 5000 }, (_, i) => i));
    expect(arr.length).toBeLessThanOrEqual(AUDIT_VALUE_MAX_CHARS + 1);
    expect(arr.endsWith("…")).toBe(true);
  });

  it("không cắt giữa cặp thay thế (emoji) — không sinh ký tự lỗi", () => {
    const s = "😀".repeat(AUDIT_VALUE_MAX_CHARS); // mỗi emoji = 2 code unit
    const out = formatAuditValue(s);
    expect(out.endsWith("…")).toBe(true);
    const last = out.charCodeAt(out.length - 2); // ký tự ngay trước dấu '…'
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false); // không kết thúc bằng nửa cặp
  });
});
