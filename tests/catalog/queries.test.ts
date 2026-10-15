import { beforeEach, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { countAllCatalogs, listActiveOptions, listCatalog } from "@/server/catalog/queries";
import { prisma, resetDb } from "../helpers/db";
beforeEach(resetDb);
describe("Catalog queries", () => {
  it("lọc không dấu, thống kê không lệch và chỉ trả option đang bật", async () => {
    await prisma.warehouse.createMany({ data: [{ name: "Kho Đông Lạnh" }, { name: "Kho Phụ", isActive: false }] });
    const result = await listCatalog(prisma, "warehouses", parseListParams({ q: "dong lanh" }, ["status"]));
    expect(result.stats).toEqual({ all: 1, active: 1, inactive: 0 }); expect(result.rows).toHaveLength(1);
    expect(await listActiveOptions(prisma, "warehouses")).toEqual([{ value: expect.any(Number), label: "Kho Đông Lạnh" }]);
    expect((await countAllCatalogs(prisma)).warehouses).toBe(2);
  });
});
