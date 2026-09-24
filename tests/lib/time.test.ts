import { describe, expect, it } from "vitest";
import { ictStartOfDay, toIct } from "@/lib/time";

describe("time (Asia/Ho_Chi_Minh, UTC+7)", () => {
  it("23:50 ICT 30/09 (16:50Z) vẫn là ngày 30/09", () => {
    const p = toIct(new Date("2026-09-30T16:50:00Z"));
    expect([p.y, p.m, p.d, p.hh, p.mm]).toEqual([2026, 8, 30, 23, 50]);
  });

  it("17:00Z = 00:00 ICT ngày hôm sau", () => {
    const p = toIct(new Date("2026-09-30T17:00:00Z"));
    expect([p.y, p.m, p.d, p.hh]).toEqual([2026, 9, 1, 0]);
  });

  it("dow: 0 = Thứ Hai … 6 = Chủ nhật (30/09/2026 là Thứ Tư)", () => {
    expect(toIct(new Date("2026-09-30T05:00:00Z")).dow).toBe(2);
    expect(toIct(new Date("2026-09-28T05:00:00Z")).dow).toBe(0);
    expect(toIct(new Date("2026-10-04T05:00:00Z")).dow).toBe(6);
  });

  it("ictStartOfDay trả 0h ICT dưới dạng thời điểm UTC", () => {
    expect(ictStartOfDay(2026, 8, 30).toISOString()).toBe("2026-09-29T17:00:00.000Z");
    expect(ictStartOfDay(2026, 9, 1).toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });

  it("ictStartOfDay tràn tháng/năm hợp lệ (m=12 → tháng 1 năm sau; d=0 → ngày cuối tháng trước)", () => {
    expect(ictStartOfDay(2026, 12, 1).toISOString()).toBe("2026-12-31T17:00:00.000Z");
    expect(ictStartOfDay(2026, 8, 0).toISOString()).toBe("2026-08-30T17:00:00.000Z");
  });
});
