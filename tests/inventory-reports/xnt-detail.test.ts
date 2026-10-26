import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { priceToBase, xntDetail } from "@/server/inventory-reports/xnt-detail";
import { prisma, resetDb } from "../helpers/db";
import { buy, engine, newWorld, sell, T, useNoopCostOwners } from "../inventory/helpers";

beforeEach(resetDb);
useNoopCostOwners();

describe("chi tiết xuất nhập tồn theo sản phẩm", () => {
  it("tồn đầu + từng dòng sổ kho khớp tổng; giá vốn chỉ hiện khi có cost.view", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20_000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 20, T(30), 1));
    const noCost = { userId: w.userId, perms: new Set(["stock.view"]) };
    const cost = { userId: w.userId, perms: new Set(["stock.view", "cost.view"]) };

    const d = (await xntDetail(prisma, noCost, w.p.id, T(5), T(40)))!;
    expect(d).toMatchObject({ opening: "100", inQty: "0", outQty: "50", closing: "50" });
    expect(d.rows.map((r) => [r.qtyOut, r.balance])).toEqual([["30", "70"], ["20", "50"]]);
    expect(d.rows[0]!.unitCostOut).toBeUndefined();

    const full = (await xntDetail(prisma, cost, w.p.id, T(0), T(40)))!;
    expect(full).toMatchObject({ opening: "0", inQty: "100", outQty: "50", closing: "50" });
    expect(full.rows[0]).toMatchObject({ qtyIn: "100", unitCost: "20000" });
    expect(full.rows[1]).toMatchObject({ qtyOut: "30", unitCostOut: "20000" });
  });

  it("giá phiếu quy về đơn vị gốc: nhân hệ số (17.600 × 3,25 = 57.200), khớp giá vốn lô", () => {
    expect(priceToBase(new Prisma.Decimal(17_600), new Prisma.Decimal(3.25))).toBe("57200");
    expect(priceToBase(new Prisma.Decimal(20_000), new Prisma.Decimal(1))).toBe("20000");
  });

  it("sản phẩm không tồn tại ⇒ null", async () => {
    const w = await newWorld();
    expect(await xntDetail(prisma, { userId: w.userId, perms: new Set(["stock.view"]) }, 999_999, T(0), T(10))).toBeNull();
  });
});
