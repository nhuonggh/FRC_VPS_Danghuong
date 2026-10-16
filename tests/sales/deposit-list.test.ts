import { beforeAll, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { DEPOSIT_FILTER_KEYS, listDeposits } from "@/server/deposits/queries";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makePeriod, makeUser } from "../helpers/factories";

const now = new Date("2026-10-16T03:00:00Z");
let actor: { userId: number; perms: Set<string> }, partnerId: number;
const params = (values: Record<string, string> = {}) => parseListParams(values, DEPOSIT_FILTER_KEYS);
beforeAll(async () => {
  await resetDb();
  const owner = await makeUser(), other = await makeUser(), period = await makePeriod(), cash = await makeCashAccount();
  actor = { userId: owner.id, perms: new Set(["deposit.manage"]) };
  const customer = await makePartner({ ownerUserId: owner.id, name: "Nguyễn Văn An", searchText: "nguyen van an" }); partnerId = customer.id;
  const outside = await makePartner({ ownerUserId: other.id });
  const order = await prisma.saleOrder.create({ data: { periodId: period.id, code: "DH000001", partnerId, orderDate: now, expectedDeliveryDate: now, originalDeliveryDate: now, createdBy: owner.id } });
  const base = { periodId: period.id, partnerId, cashAccountId: cash.id, createdBy: owner.id, type: "COC" as const, at: now, orderId: order.id };
  await prisma.receipt.createMany({ data: [
    { ...base, code: "PT001", amount: "35000.25", at: new Date("2026-10-15T17:00:00Z"), reviewStatus: "REVIEWED" },
    { ...base, code: "PT002", amount: "175000.75" },
    { ...base, code: "PT003", amount: "100000", orderId: null },
    { ...base, code: "PT004", amount: "750000", isCancelled: true },
    { ...base, code: "PT005", amount: "5000", at: new Date("2026-10-15T16:59:59Z") },
    { ...base, code: "PT006", amount: "7000", at: new Date("2026-10-16T17:00:00Z") },
    { ...base, code: "PT007", amount: "999", partnerId: outside.id },
    { ...base, code: "PT008", amount: "10000000", type: "THU_NO" },
  ] });
});
describe("deposit list filters and summaries", () => {
  it("uses ICT date boundaries, excludes other owners and non-deposit receipts, and sums beyond the page", async () => {
    const result = await listDeposits(prisma, actor, { ...params({ timePreset: "today" }), pageSize: 1 }, now);
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(4);
    expect(result.stats).toEqual({ all: { count: 4, amount: "310001" }, attached: { count: 2, amount: "210001" }, released: { count: 1, amount: "100000" }, cancelled: { count: 1, amount: "750000" } });
    expect(result.effectiveAmount).toBe("310001");
    expect(result.timeCounts.today).toBe(4);
    expect(result.timeCounts.yesterday).toBe(1);
    expect(result.timeCounts.all).toBe(6);
    expect(result.customers.map((c) => c.id)).toEqual([partnerId]);
  });
  it("status cards keep the full date-filtered summary while quick day counts respect status", async () => {
    const result = await listDeposits(prisma, actor, params({ timePreset: "today", state: "released" }), now);
    expect(result.total).toBe(1);
    expect(result.rows[0].orderId).toBeNull();
    expect(result.stats.attached.count).toBe(2);
    expect(result.effectiveAmount).toBe("100000");
    expect(result.timeCounts.all).toBe(1);
    expect((await listDeposits(prisma, actor, params({ state: "cancelled" }), now)).effectiveAmount).toBe("0");
  });
  it("customer and text filters combine and cannot broaden partner access", async () => {
    expect((await listDeposits(prisma, actor, params({ customer: String(partnerId), q: "Nguyễn An DH000001", state: "attached", timePreset: "today" }), now)).total).toBe(2);
    expect((await listDeposits(prisma, actor, params({ q: "PT007" }), now)).total).toBe(0);
    expect((await listDeposits(prisma, actor, params({ customer: "invalid" }), now)).total).toBe(0);
    expect((await listDeposits(prisma, actor, params({ state: "constructor" }), now)).total).toBe(6);
  });
});
