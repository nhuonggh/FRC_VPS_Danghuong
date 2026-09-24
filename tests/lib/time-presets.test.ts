import { describe, expect, it } from "vitest";
import { parseYmd, resolveTimeRange, TIME_PRESETS, timeRangeWhere, type TimePreset } from "@/lib/time-presets";

// Test này phải cho kết quả GIỐNG HỆT dù máy chạy ở múi giờ nào (chạy với TZ=UTC và TZ=PST8PDT).
const NOW = new Date("2026-09-30T16:50:00Z"); // 23:50 ICT, Thứ Tư 30/09/2026
const r = (p: TimePreset, now = NOW, custom?: { start?: string; end?: string }) => {
  const x = resolveTimeRange(p, now, custom)!;
  return [x.start.toISOString(), x.end.toISOString()];
};
/** now có thuộc nửa mở [start, end) của preset không. */
const inside = (p: TimePreset, at: Date, now = NOW) => {
  const x = resolveTimeRange(p, now)!;
  return at.getTime() >= x.start.getTime() && at.getTime() < x.end.getTime();
};

describe("TIME_PRESETS — đủ 10 mốc theo crm-design", () => {
  it("thứ tự và nhãn", () => {
    expect(TIME_PRESETS.map((p) => p.label)).toEqual([
      "Hôm nay", "Tuần này", "Tháng này", "Quý này", "Tuần trước", "Tháng trước", "Quý trước",
      "Năm nay", "Năm trước", "Tùy chọn",
    ]);
  });
  it("giá trị (value) đúng và duy nhất", () => {
    expect(TIME_PRESETS.map((p) => p.value)).toEqual([
      "today", "thisWeek", "thisMonth", "thisQuarter", "lastWeek", "lastMonth", "lastQuarter", "thisYear", "lastYear", "custom",
    ]);
  });
});

describe("resolveTimeRange — nửa mở [start, end), theo giờ ICT", () => {
  it("Hôm nay: 23:50 ICT 30/09 vẫn thuộc ngày 30/09", () => {
    expect(r("today")).toEqual(["2026-09-29T17:00:00.000Z", "2026-09-30T17:00:00.000Z"]);
    expect(inside("today", NOW)).toBe(true);
  });

  it("đúng 00:00 ICT ngày 01/10 (17:00Z) đã sang ngày/tháng/quý mới; 23:59:59.999 ICT vẫn ở ngày cũ", () => {
    const edge = new Date("2026-09-30T17:00:00Z");
    const justBefore = new Date("2026-09-30T16:59:59.999Z");
    expect(r("today", edge)).toEqual(["2026-09-30T17:00:00.000Z", "2026-10-01T17:00:00.000Z"]);
    expect(r("thisMonth", edge)).toEqual(["2026-09-30T17:00:00.000Z", "2026-10-31T17:00:00.000Z"]);
    expect(r("thisQuarter", edge)).toEqual(["2026-09-30T17:00:00.000Z", "2026-12-31T17:00:00.000Z"]);
    // đơn 00:00 ICT 01/10 KHÔNG thuộc tháng 9, đơn 23:59:59.999 ICT 30/09 thuộc tháng 9
    expect(inside("thisMonth", edge, NOW)).toBe(false);
    expect(inside("thisMonth", justBefore, NOW)).toBe(true);
    expect(inside("thisQuarter", edge, NOW)).toBe(false);
    expect(inside("today", edge, NOW)).toBe(false);
  });

  it("Tuần này bắt đầu THỨ HAI (28/09) đến hết Chủ nhật (04/10)", () => {
    expect(r("thisWeek")).toEqual(["2026-09-27T17:00:00.000Z", "2026-10-04T17:00:00.000Z"]);
  });

  it("Tuần này: Chủ nhật 23:59 ICT vẫn thuộc tuần chứa nó; Thứ Hai 00:00 ICT sang tuần mới", () => {
    const sun = new Date("2026-10-04T16:59:00Z"); // CN 04/10 23:59 ICT
    const mon = new Date("2026-10-04T17:00:00Z"); // Thứ Hai 05/10 00:00 ICT
    expect(r("thisWeek", sun)).toEqual(["2026-09-27T17:00:00.000Z", "2026-10-04T17:00:00.000Z"]);
    expect(r("thisWeek", mon)).toEqual(["2026-10-04T17:00:00.000Z", "2026-10-11T17:00:00.000Z"]);
    expect(r("lastWeek", mon)).toEqual(["2026-09-27T17:00:00.000Z", "2026-10-04T17:00:00.000Z"]);
    expect(r("lastWeek", sun)).toEqual(["2026-09-20T17:00:00.000Z", "2026-09-27T17:00:00.000Z"]);
  });

  it("Tuần này giữa trưa Chủ nhật vẫn là tuần chứa nó (không nhảy sang tuần sau)", () => {
    const sunday = new Date("2026-10-04T05:00:00Z"); // CN 04/10 12:00 ICT
    expect(r("thisWeek", sunday)).toEqual(["2026-09-27T17:00:00.000Z", "2026-10-04T17:00:00.000Z"]);
  });

  it("Tuần trước", () => {
    expect(r("lastWeek")).toEqual(["2026-09-20T17:00:00.000Z", "2026-09-27T17:00:00.000Z"]);
  });

  it("Tuần này/Tuần trước cắt qua ranh giới tháng và năm", () => {
    const thu = new Date("2026-07-02T05:00:00Z"); // Thứ Năm 02/07 → tuần bắt đầu Thứ Hai 29/06
    expect(r("thisWeek", thu)).toEqual(["2026-06-28T17:00:00.000Z", "2026-07-05T17:00:00.000Z"]);
    const fri = new Date("2026-01-02T05:00:00Z"); // Thứ Sáu 02/01/2026 → tuần bắt đầu Thứ Hai 29/12/2025
    expect(r("thisWeek", fri)).toEqual(["2025-12-28T17:00:00.000Z", "2026-01-04T17:00:00.000Z"]);
    expect(r("lastWeek", fri)).toEqual(["2025-12-21T17:00:00.000Z", "2025-12-28T17:00:00.000Z"]);
  });

  it("Tháng này / trước", () => {
    expect(r("thisMonth")).toEqual(["2026-08-31T17:00:00.000Z", "2026-09-30T17:00:00.000Z"]);
    expect(r("lastMonth")).toEqual(["2026-07-31T17:00:00.000Z", "2026-08-31T17:00:00.000Z"]);
  });

  it("Tháng trước khi đang ở tháng 1 → tháng 12 năm trước", () => {
    const jan = new Date("2026-01-15T05:00:00Z");
    expect(r("lastMonth", jan)).toEqual(["2025-11-30T17:00:00.000Z", "2025-12-31T17:00:00.000Z"]);
  });

  it("Tháng 2 năm nhuận: 29 ngày", () => {
    expect(r("thisMonth", new Date("2028-02-10T05:00:00Z"))).toEqual(["2028-01-31T17:00:00.000Z", "2028-02-29T17:00:00.000Z"]);
  });

  it("Quý này (Q3) / trước (Q2)", () => {
    expect(r("thisQuarter")).toEqual(["2026-06-30T17:00:00.000Z", "2026-09-30T17:00:00.000Z"]);
    expect(r("lastQuarter")).toEqual(["2026-03-31T17:00:00.000Z", "2026-06-30T17:00:00.000Z"]);
  });

  it("Quý trước khi đang ở Q1 → Q4 năm trước", () => {
    const feb = new Date("2026-02-10T05:00:00Z");
    expect(r("lastQuarter", feb)).toEqual(["2025-09-30T17:00:00.000Z", "2025-12-31T17:00:00.000Z"]);
    expect(r("thisQuarter", feb)).toEqual(["2025-12-31T17:00:00.000Z", "2026-03-31T17:00:00.000Z"]);
  });

  it("Quý này khi đang ở Q4 → hết năm (sang 01/01 năm sau)", () => {
    expect(r("thisQuarter", new Date("2026-11-15T05:00:00Z"))).toEqual(["2026-09-30T17:00:00.000Z", "2026-12-31T17:00:00.000Z"]);
  });

  it("Năm nay / trước", () => {
    expect(r("thisYear")).toEqual(["2025-12-31T17:00:00.000Z", "2026-12-31T17:00:00.000Z"]);
    expect(r("lastYear")).toEqual(["2024-12-31T17:00:00.000Z", "2025-12-31T17:00:00.000Z"]);
  });

  it("Năm nay: 23:59:59.999 ICT 31/12 vẫn là năm cũ, 00:00 ICT 01/01 sang năm mới", () => {
    const before = new Date("2026-12-31T16:59:59.999Z");
    const after = new Date("2026-12-31T17:00:00.000Z");
    expect(r("thisYear", before)).toEqual(["2025-12-31T17:00:00.000Z", "2026-12-31T17:00:00.000Z"]);
    expect(r("thisYear", after)).toEqual(["2026-12-31T17:00:00.000Z", "2027-12-31T17:00:00.000Z"]);
    expect(r("lastYear", after)).toEqual(["2025-12-31T17:00:00.000Z", "2026-12-31T17:00:00.000Z"]);
  });

  it("các preset liền kề nhau khớp khít (không hở, không chồng) — tuần/tháng/quý/năm", () => {
    for (const [cur, prev] of [["thisWeek", "lastWeek"], ["thisMonth", "lastMonth"], ["thisQuarter", "lastQuarter"], ["thisYear", "lastYear"]] as const) {
      expect(resolveTimeRange(prev, NOW)!.end.getTime()).toBe(resolveTimeRange(cur, NOW)!.start.getTime());
    }
  });

  it("Tùy chọn: 'yyyy-mm-dd' bao gồm CẢ ngày kết thúc (end = 0h ICT ngày kế)", () => {
    expect(r("custom", NOW, { start: "2026-09-01", end: "2026-09-15" })).toEqual([
      "2026-08-31T17:00:00.000Z", "2026-09-15T17:00:00.000Z",
    ]);
  });

  it("Tùy chọn: một ngày (start = end) = đúng ngày đó; kết thúc ngày cuối tháng/năm tràn đúng", () => {
    expect(r("custom", NOW, { start: "2026-09-30", end: "2026-09-30" })).toEqual(["2026-09-29T17:00:00.000Z", "2026-09-30T17:00:00.000Z"]);
    expect(r("custom", NOW, { start: "2026-12-30", end: "2026-12-31" })).toEqual(["2026-12-29T17:00:00.000Z", "2026-12-31T17:00:00.000Z"]);
  });

  it("Tùy chọn: thiếu/không hợp lệ hoặc end < start → null (không lọc)", () => {
    expect(resolveTimeRange("custom", NOW)).toBeNull();
    expect(resolveTimeRange("custom", NOW, {})).toBeNull();
    expect(resolveTimeRange("custom", NOW, { start: "2026-09-01" })).toBeNull();
    expect(resolveTimeRange("custom", NOW, { end: "2026-09-01" })).toBeNull();
    expect(resolveTimeRange("custom", NOW, { start: "abc", end: "2026-09-15" })).toBeNull();
    expect(resolveTimeRange("custom", NOW, { start: "2026-09-15", end: "2026-09-01" })).toBeNull();
    expect(resolveTimeRange("custom", NOW, { start: "2026-02-30", end: "2026-03-01" })).toBeNull(); // 30/02 không tồn tại
    expect(resolveTimeRange("custom", NOW, { start: "2026-9-1", end: "2026-09-15" })).toBeNull(); // thiếu số 0
  });
});

describe("parseYmd", () => {
  it("hợp lệ → {y, m (0–11), d}", () => {
    expect(parseYmd("2026-09-30")).toEqual({ y: 2026, m: 8, d: 30 });
    expect(parseYmd("2028-02-29")).toEqual({ y: 2028, m: 1, d: 29 }); // năm nhuận
  });
  it("sai định dạng / ngày không tồn tại → null", () => {
    for (const s of [undefined, "", "2026-13-01", "2026-00-10", "2026-04-31", "2027-02-29", "26-09-30", "2026/09/30", "2026-09-30T00:00"]) {
      expect(parseYmd(s), String(s)).toBeNull();
    }
  });
});

describe("timeRangeWhere", () => {
  it("nửa mở: gte start, lt end (không dùng lte để đơn 00:00 ngày kế không lọt vào)", () => {
    const x = resolveTimeRange("today", NOW)!;
    expect(timeRangeWhere(x)).toEqual({ gte: x.start, lt: x.end });
  });
});
