import { beforeEach, describe, expect, it } from "vitest";
import { DocDateBeforePeriodError, PeriodClosedError } from "@/server/inventory/errors";
import { assertDocDateInPeriod, assertPeriodOpen, getOpenPeriod } from "@/server/period/guard";
import { prisma, resetDb } from "../helpers/db";
import { makePeriod } from "../helpers/factories";

beforeEach(resetDb);

describe("getOpenPeriod / assertPeriodOpen", () => {
  it("trả kỳ đang mở; kỳ đã đóng → PeriodClosedError tiếng Việt", async () => {
    const closed = await makePeriod({ status: "CLOSED", isOpen: null, closedAt: new Date() });
    const open = await makePeriod();
    expect((await getOpenPeriod(prisma)).id).toBe(open.id);
    await expect(assertPeriodOpen(prisma, closed.id)).rejects.toThrow(PeriodClosedError);
    await expect(assertPeriodOpen(prisma, closed.id)).rejects.toThrow("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.");
    expect((await assertPeriodOpen(prisma, open.id)).id).toBe(open.id);
  });

  it("không có kỳ nào mở → lỗi rõ ràng", async () => {
    await expect(getOpenPeriod(prisma)).rejects.toThrow("Hệ thống chưa có kỳ đang mở.");
  });

  it("kỳ không tồn tại → PeriodClosedError (coi như không ghi được)", async () => {
    await expect(assertPeriodOpen(prisma, 99999)).rejects.toThrow(PeriodClosedError);
  });
});

describe("assertDocDateInPeriod — không ghi ngày trước ngày mở kỳ", () => {
  const period = { id: 1, openedAt: new Date("2026-09-24T03:00:00Z") }; // 10:00 ICT 24/09

  it("cho phép chứng từ từ đầu ngày mở kỳ (ICT) trở đi", () => {
    expect(() => assertDocDateInPeriod(period, new Date("2026-09-23T17:00:00Z"))).not.toThrow(); // 00:00 ICT 24/09
    expect(() => assertDocDateInPeriod(period, new Date("2026-09-24T05:00:00Z"))).not.toThrow();
  });

  it("chặn chứng từ thuộc ngày trước ngày mở kỳ", () => {
    expect(() => assertDocDateInPeriod(period, new Date("2026-09-23T16:59:59.999Z"))).toThrow(DocDateBeforePeriodError);
    expect(() => assertDocDateInPeriod(period, new Date("2026-09-23T16:59:59.999Z"))).toThrow("Ngày chứng từ trước ngày mở kỳ hiện tại");
  });
});
