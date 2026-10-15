import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { exportXntXlsx } from "@/server/inventory-reports/export";
import { prisma, resetDb } from "../helpers/db";
import { buy, engine, newWorld, sell, T, useNoopCostOwners } from "../inventory/helpers";

beforeEach(resetDb);
useNoopCostOwners();

async function headers(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  return ((workbook.worksheets[0]!.getRow(1).values as unknown[]).slice(1) as string[]);
}

describe("exportXntXlsx", () => {
  it("chỉ thêm bốn cột giá trị khi người xem có cost.view", async () => {
    const world = await newWorld();
    const run = engine(world);
    await run([world.p.id], (ctx) => buy(ctx, world.p.id, 10, 20_000, T(0), 1));
    await run([world.p.id], (ctx) => sell(ctx, world.p.id, 2, T(1), 1));
    const denied = await headers(await exportXntXlsx(prisma, { userId: world.userId, perms: new Set(["stock.view"]) }, T(0), T(2)));
    expect(denied).not.toContain("Giá trị tồn cuối");
    const allowed = await headers(await exportXntXlsx(prisma, { userId: world.userId, perms: new Set(["stock.view", "cost.view"]) }, T(0), T(2)));
    expect(allowed).toEqual(expect.arrayContaining(["Giá trị tồn đầu", "Giá trị nhập", "Giá trị xuất", "Giá trị tồn cuối"]));
  });
});
