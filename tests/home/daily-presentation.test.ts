import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { parseListParams } from "@/lib/query-params";
import { DAILY_FILTER_KEYS } from "@/server/home/daily-config";
import { dailyRange, dailyWhere, loadDailyPartners } from "@/server/home/daily";
import { canReviewParams } from "@/server/home/daily-review";

const now = new Date("2026-10-16T03:00:00Z");
describe("daily presentation filters", () => {
  it("keeps group and empty visibility presentational while partner subsets cannot be confirmed", () => {
    const params = parseListParams({ dailyGroup: "cash", showEmpty: "1", timePreset: "today" }, DAILY_FILTER_KEYS);
    expect(canReviewParams(params)).toBe(true);
    expect(canReviewParams({ ...params, filters: { ...params.filters, partner: ["A Đô MT"] } })).toBe(false);
    expect(canReviewParams({ ...params, q: "PT01" })).toBe(false);
  });
  it("binds partner names as values and combines them with the date and document state", () => {
    const name = "O'Neil'; DROP TABLE partners; --";
    const params = parseListParams({ partner: name, timePreset: "today" }, DAILY_FILTER_KEYS);
    const where = dailyWhere("receipts", params, dailyRange(params, now));
    expect(where.text).toContain("d.partner IN");
    expect(where.text).toContain("d.cancelled =");
    expect(where.text).not.toContain(name);
    expect(where.values).toContain(name);
    expect(where.values).toContain(false);
  });
  it("loads partner options from permitted document sources without the selected partner constraint", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ partner: "A Đô MT" }]) };
    const actor = { userId: 9, perms: new Set(["return.manage"]) };
    const params = parseListParams({ partner: "Selected", timePreset: "today" }, DAILY_FILTER_KEYS);
    expect(await loadDailyPartners(db as unknown as Parameters<typeof loadDailyPartners>[0], actor, params, now)).toEqual(["A Đô MT"]);
    const call = db.$queryRaw.mock.calls[0];
    const query = Prisma.sql(call[0], ...call.slice(1));
    expect(query.text).toContain("ownerUserId");
    expect(query.text).not.toContain("FROM receipts");
    expect(query.values).not.toContain("Selected");
  });
});
