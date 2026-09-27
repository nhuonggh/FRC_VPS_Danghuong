import { describe, expect, it } from "vitest";
import { ictStartOfDay, ictYmd, toIct } from "@/lib/time";

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
  it("ranh giới tuần: Chủ nhật 23:59 ICT (16:59Z) dow=6, 00:00 ICT thứ Hai (17:00Z) dow=0", () => {
    const sun = toIct(new Date("2026-10-04T16:59:00Z"));
    expect([sun.d, sun.dow, sun.hh, sun.mm]).toEqual([4, 6, 23, 59]);
    const mon = toIct(new Date("2026-10-04T17:00:00Z"));
    expect([mon.m, mon.d, mon.dow, mon.hh, mon.mm]).toEqual([9, 5, 0, 0, 0]);
  });

  it("ranh giới cuối tháng/năm: ngày ICT sang ngày mới đúng (năm nhuận, cuối năm)", () => {
    const feb29 = toIct(new Date("2028-02-28T17:00:00Z"));
    expect([feb29.y, feb29.m, feb29.d]).toEqual([2028, 1, 29]);
    const mar1 = toIct(new Date("2028-02-29T17:00:00Z"));
    expect([mar1.y, mar1.m, mar1.d]).toEqual([2028, 2, 1]);
    const ny = toIct(new Date("2026-12-31T17:00:00Z"));
    expect([ny.y, ny.m, ny.d, ny.dow]).toEqual([2027, 0, 1, 4]); // 01/01/2027 là Thứ Sáu
    const eve = toIct(new Date("2026-12-31T16:59:59.999Z"));
    expect([eve.y, eve.m, eve.d]).toEqual([2026, 11, 31]);
  });

  it("ictStartOfDay khớp toIct: 0h ICT thứ Hai", () => {
    expect(ictStartOfDay(2026, 9, 5).toISOString()).toBe("2026-10-04T17:00:00.000Z");
    expect(toIct(ictStartOfDay(2026, 9, 5)).dow).toBe(0);
  });

  it("ictYmd luôn dùng lịch ICT, không dùng timezone của máy chạy", () => {
    expect(ictYmd(new Date("2026-09-30T16:59:59Z"))).toBe("2026-09-30");
    expect(ictYmd(new Date("2026-09-30T17:00:00Z"))).toBe("2026-10-01");
  });
});
