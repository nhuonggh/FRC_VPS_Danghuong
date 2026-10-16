import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { listDeletedOrders } from "@/server/sales/queries";
import type { Actor } from "@/lib/permissions/scope";

const now = new Date("2026-10-16T03:00:00Z");
function setup(price = true) {
  const db = {
    saleOrder: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(2) },
    saleOrderLine: { groupBy: vi.fn().mockResolvedValue([{ qty: new Prisma.Decimal(1), salePrice: new Prisma.Decimal(356400), discountNow: new Prisma.Decimal(1000), _count: { _all: 2 } }]) },
    user: { findMany: vi.fn().mockResolvedValue([]) }, partner: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const actor: Actor = { userId: 7, perms: new Set(["order.restore", "partner.view_all", ...(price ? ["sale_price.view"] : [])]) };
  return { db, actor };
}
describe("deleted order summary", () => {
  it("filters by cancellation time and customer, and totals all matching lines with per-line rounding", async () => {
    const { db, actor } = setup();
    const params = parseListParams({ timePreset: "today", customer: "12", q: "hủy", page: "2" }, ["customer"]);
    const result = await listDeletedOrders(db as unknown as Parameters<typeof listDeletedOrders>[0], actor, params, now);
    const request = db.saleOrder.findMany.mock.calls[0][0];
    expect(request.skip).toBe(params.pageSize);
    expect(request.where.AND).toContainEqual({ cancelledAt: { gte: new Date("2026-10-15T17:00:00Z"), lt: new Date("2026-10-16T17:00:00Z") } });
    expect(request.where.AND[0].AND).toContainEqual({ partnerId: { in: [12] } });
    expect(JSON.stringify(request.where)).toContain("cancelReason");
    expect(db.saleOrderLine.groupBy.mock.calls[0][0].where.order).toEqual(request.where);
    expect(result.amount).toBe("712000");
    expect(result.counts.today).toBe(2);
  });
  it("does not query or expose money without sale price permission", async () => {
    const { db, actor } = setup(false);
    const result = await listDeletedOrders(db as unknown as Parameters<typeof listDeletedOrders>[0], actor, parseListParams({}), now);
    expect(db.saleOrderLine.groupBy).not.toHaveBeenCalled();
    expect(result.amount).toBeUndefined();
  });
});
