import { describe, expect, it } from "vitest";
import { InvalidDocDateError } from "@/server/inventory/errors";
import { docTimestamp } from "@/server/inventory/time";

describe("docTimestamp — thời điểm ghi sổ theo giờ ICT", () => {
  it("chứng từ ngày HÔM NAY (ICT) → đúng thời điểm hiện tại", () => {
    const now = new Date("2026-09-30T16:50:00Z"); // 23:50 ICT 30/09
    expect(docTimestamp("2026-09-30", now)).toEqual(now);
  });

  it("23:50 ICT 30/09: chứng từ ngày 01/10 là NGÀY MAI theo ICT → bị từ chối (không nhảy ngày theo UTC)", () => {
    const now = new Date("2026-09-30T16:50:00Z");
    expect(() => docTimestamp("2026-10-01", now)).toThrow("Ngày chứng từ không được ở tương lai.");
  });

  it("chứng từ ngày QUÁ KHỨ → 23:59:59.999 ICT của ngày đó", () => {
    const now = new Date("2026-09-30T05:00:00Z");
    expect(docTimestamp("2026-09-15", now).toISOString()).toBe("2026-09-15T16:59:59.999Z");
  });

  it("00:05 ICT ngày 01/10: chứng từ ngày 30/09 là quá khứ → cuối ngày 30/09 ICT", () => {
    const now = new Date("2026-09-30T17:05:00Z"); // 00:05 ICT 01/10
    expect(docTimestamp("2026-09-30", now).toISOString()).toBe("2026-09-30T16:59:59.999Z");
    expect(docTimestamp("2026-10-01", now)).toEqual(now);
  });

  it("nhận Date: lấy phần NGÀY theo ICT", () => {
    const now = new Date("2026-09-30T05:00:00Z");
    expect(docTimestamp(new Date("2026-09-14T20:00:00Z"), now).toISOString()).toBe("2026-09-15T16:59:59.999Z"); // 03:00 ICT 15/09
  });

  it("ngày tương lai hoặc không hợp lệ → InvalidDocDateError tiếng Việt", () => {
    const now = new Date("2026-09-30T05:00:00Z");
    expect(() => docTimestamp("2026-10-02", now)).toThrow(InvalidDocDateError);
    expect(() => docTimestamp("2026-10-02", now)).toThrow("Ngày chứng từ không được ở tương lai.");
    expect(() => docTimestamp("2026-02-30", now)).toThrow("Ngày chứng từ không hợp lệ.");
    expect(() => docTimestamp("abc", now)).toThrow("Ngày chứng từ không hợp lệ.");
    expect(() => docTimestamp(new Date("invalid"), now)).toThrow("Ngày chứng từ không hợp lệ.");
  });

  it("biên 00:00:00.000 và 23:59:59.999 ICT: vẫn cùng ngày ICT → trả đúng `now`", () => {
    const start = new Date("2026-09-29T17:00:00.000Z"); // 00:00:00.000 ICT 30/09
    const end = new Date("2026-09-30T16:59:59.999Z"); // 23:59:59.999 ICT 30/09
    expect(docTimestamp("2026-09-30", start)).toEqual(start);
    expect(docTimestamp("2026-09-30", end)).toEqual(end);
    // 1ms trước nửa đêm ICT: ngày 29/09 đã là quá khứ → cuối ngày 29/09
    const before = new Date("2026-09-29T16:59:59.999Z"); // 23:59:59.999 ICT 29/09
    expect(docTimestamp("2026-09-29", before)).toEqual(before);
    expect(docTimestamp("2026-09-29", start).toISOString()).toBe("2026-09-29T16:59:59.999Z");
  });

  it("ngày quá khứ luôn CÙNG một mốc dù gọi lúc nào trong ngày (ổn định cho sắp (at,id))", () => {
    const a = docTimestamp("2026-09-15", new Date("2026-09-30T00:00:00Z"));
    const b = docTimestamp("2026-09-15", new Date("2026-09-30T16:00:00Z"));
    expect(a.getTime()).toBe(b.getTime());
  });

  it("ranh giới năm/tháng/năm nhuận: 01/01 và 29/02", () => {
    const now = new Date("2028-03-01T05:00:00Z");
    expect(docTimestamp("2027-12-31", now).toISOString()).toBe("2027-12-31T16:59:59.999Z");
    expect(docTimestamp("2028-02-29", now).toISOString()).toBe("2028-02-29T16:59:59.999Z");
    expect(() => docTimestamp("2027-02-29", now)).toThrow("Ngày chứng từ không hợp lệ.");
  });
});
