import { describe, expect, it } from "vitest";
import { auditActionLabel, auditEntityLabel } from "@/lib/audit-labels";
import { auditStats, auditWhere } from "@/server/audit/queries";
import { parseListParams } from "@/lib/query-params";
import type { PrismaClient } from "@prisma/client";

describe("audit display and summary", () => {
  it("uses Vietnamese labels and preserves unknown codes", () => {
    expect(auditActionLabel("supplier-order.send")).toBe("Gửi nhà cung cấp");
    expect(auditEntityLabel("SaleOrder")).toBe("Đơn bán hàng");
    expect(auditActionLabel("period.close")).toBe("Kết sổ kỳ");
    expect(auditActionLabel("future.action")).toBe("future.action");
  });
  it("searches Vietnamese labels", () => {
    const where = auditWhere(parseListParams({ q: "Đơn bán hàng" }), new Date());
    expect(where.OR).toContainEqual({ entity: { in: ["SaleOrder"] } });
  });
  it("aggregates using filters without page limits and excludes the system from people count", async () => {
    const calls: unknown[] = [];
    const db = { auditLog: { groupBy: async (args: unknown) => { calls.push(args); return [{}, {}]; } } } as unknown as PrismaClient;
    const params = parseListParams({ entity: "SaleOrder", page: "2" }, ["entity"]);
    expect(await auditStats(db, params)).toEqual({ users: 2, entities: 2, actions: 2 });
    expect(calls).toEqual([
      { by: ["userId"], where: { AND: [{ entity: { in: ["SaleOrder"] } }, { userId: { not: null } }] } },
      { by: ["entity"], where: { entity: { in: ["SaleOrder"] } } },
      { by: ["action"], where: { entity: { in: ["SaleOrder"] } } },
    ]);
  });
});
