import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePeriod, makeUser } from "../helpers/factories";
import { parseListParams } from "@/lib/query-params";
import type { Actor } from "@/lib/permissions/scope";
import { loadDailyItem } from "@/server/home/daily";
import { canReviewParams, getDailyReviews, reviewSchema, reviewState, singleReviewDay, updateDailyReview } from "@/server/home/daily-review";

const now = new Date("2026-10-15T03:00:00Z"), day = "2026-10-15";
const params = parseListParams({ timePreset: "today" });
let actor: Actor, other: Actor, periodId: number, accountId: number;
const input = async (action: "seen" | "check" | "uncheck") => ({ day, itemKey: "receipts", action, expectedVersion: (await loadDailyItem(prisma, actor, "receipts", params, now, { summaryOnly: true })).totals.version! });
beforeEach(async () => {
  await resetDb();
  actor = { userId: (await makeUser()).id, perms: new Set(["receipt.manage"]) };
  other = { userId: (await makeUser()).id, perms: new Set(["receipt.manage"]) };
  periodId = (await makePeriod()).id; accountId = (await makeCashAccount()).id;
  await prisma.receipt.create({ data: { code: "PT1", periodId, createdBy: actor.userId, cashAccountId: accountId, at: now, type: "KHAC", amount: 100 } });
});

describe("personal daily review persistence", () => {
  it("requires viewing before check, persists seen/check/uncheck and isolates users and days", async () => {
    await expect(updateDailyReview(prisma, actor, await input("check"), now)).rejects.toMatchObject({ status: 409 });
    expect((await updateDailyReview(prisma, actor, await input("seen"), now)).status).toBe("seen");
    expect((await updateDailyReview(prisma, actor, await input("check"), now)).status).toBe("checked");
    const records = await getDailyReviews(prisma, actor, day);
    expect(records).toHaveLength(1);
    expect(reviewState(records[0], (await input("seen")).expectedVersion).status).toBe("checked");
    expect(await getDailyReviews(prisma, other, day)).toEqual([]);
    expect(await getDailyReviews(prisma, actor, "2026-10-14")).toEqual([]);
    expect((await updateDailyReview(prisma, actor, await input("uncheck"), now)).status).toBe("seen");
    expect((await getDailyReviews(prisma, actor, day))[0]!.checkedAt).toBeNull();
  });
  it("repeated seen/check requests are idempotent and audited once per transition", async () => {
    const seen = await input("seen"), check = await input("check");
    await updateDailyReview(prisma, actor, seen, now);
    await updateDailyReview(prisma, actor, seen, now);
    await updateDailyReview(prisma, actor, check, now);
    await updateDailyReview(prisma, actor, check, now);
    expect(await prisma.dailyReview.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { entity: "DailyReview" } })).toBe(2);
  });
  it("new or amended data invalidates the previous confirmation and rejects stale clicks", async () => {
    const old = await input("seen");
    await updateDailyReview(prisma, actor, old, now);
    await updateDailyReview(prisma, actor, { ...old, action: "check" }, now);
    await prisma.receipt.update({ where: { code: "PT1" }, data: { amount: 200 } });
    const current = await input("seen");
    expect(current.expectedVersion).not.toBe(old.expectedVersion);
    expect(reviewState((await getDailyReviews(prisma, actor, day))[0], current.expectedVersion).status).toBe("changed");
    await expect(updateDailyReview(prisma, actor, { ...old, action: "check" }, now)).rejects.toMatchObject({ status: 409 });
    expect((await updateDailyReview(prisma, actor, current, now)).status).toBe("seen");
    expect((await updateDailyReview(prisma, actor, { ...current, action: "check" }, now)).status).toBe("checked");
  });
  it("checks an empty day, rejects future days, missing permissions and spoofed user IDs", async () => {
    const emptyParams = parseListParams({ timePreset: "custom", timeStart: "2026-10-14", timeEnd: "2026-10-14" });
    const empty = (await loadDailyItem(prisma, actor, "receipts", emptyParams, now, { summaryOnly: true })).totals;
    expect(empty.count).toBe(0);
    await updateDailyReview(prisma, actor, { day: "2026-10-14", itemKey: "receipts", action: "seen", expectedVersion: empty.version! }, now);
    expect((await updateDailyReview(prisma, actor, { day: "2026-10-14", itemKey: "receipts", action: "check", expectedVersion: empty.version! }, now)).status).toBe("checked");
    await expect(updateDailyReview(prisma, actor, { ...await input("seen"), day: "2026-10-16" }, now)).rejects.toMatchObject({ status: 400 });
    await expect(updateDailyReview(prisma, { ...actor, perms: new Set() }, await input("seen"), now)).rejects.toMatchObject({ status: 403 });
    expect(reviewSchema.safeParse({ ...await input("seen"), userId: other.userId }).success).toBe(false);
  });
  it("only unfiltered single-day categories can be confirmed", () => {
    expect(canReviewParams({ ...params, filters: { state: ["active"], type: ["LOSS"] } })).toBe(true);
    expect(canReviewParams({ ...params, q: "PT1" })).toBe(false);
    expect(canReviewParams({ ...params, filters: { state: ["cancelled"] } })).toBe(false);
    expect(singleReviewDay({ start: new Date("2026-10-14T17:00:00Z"), end: new Date("2026-10-15T17:00:00Z") }, now)).toBe(day);
    expect(singleReviewDay({ start: new Date("2026-10-13T17:00:00Z"), end: new Date("2026-10-15T17:00:00Z") }, now)).toBeNull();
  });
});
