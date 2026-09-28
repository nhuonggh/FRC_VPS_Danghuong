import { beforeEach, describe, expect, it } from "vitest";
import { onHandList } from "@/server/inventory-reports/on-hand";
import { productStock } from "@/server/inventory-reports/product-stock";
import { stockCard, stockCardList } from "@/server/inventory-reports/stock-card";
import { xntList, xntReport } from "@/server/inventory-reports/xnt";
import { prisma, resetDb } from "../helpers/db";
import { buy, engine, newWorld, sell, T, useNoopCostOwners } from "../inventory/helpers";

beforeEach(resetDb);
useNoopCostOwners();

const params = { page: 1, pageSize: 20, filters: {} };

describe("báo cáo kho", () => {
  it("tồn hiện tại, thẻ kho và XNT cùng cân theo sổ; giá bị ẩn server-side khi thiếu cost.view", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20_000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    const noCost = { userId: w.userId, perms: new Set(["stock.view"]) };
    const cost = { userId: w.userId, perms: new Set(["stock.view", "cost.view", "purchase_price.view"]) };

    const onHand = await onHandList(prisma, noCost, params);
    expect(onHand.rows[0]).toMatchObject({ onHand: "70" });
    expect(onHand.rows[0]!.stockValue).toBeUndefined();
    expect((await onHandList(prisma, cost, params)).rows[0]!.stockValue).toBe("1400000");

    const card = await stockCard(prisma, noCost, w.p.id);
    expect(card.at(-1)).toMatchObject({ balance: "70" });
    expect(card[0]!.unitCost).toBeUndefined();
    expect((await stockCard(prisma, cost, w.p.id))[1]!.unitCost).toBe("20000");

    const xnt = await xntReport(prisma, noCost, T(0), T(20));
    expect(xnt.rows[0]).toMatchObject({ opening: "0", inQty: "100", outQty: "30", closing: "70" });
    expect(xnt.totals).toEqual({ opening: "0", inQty: "100", outQty: "30", closing: "70" });
    expect(xnt.rows[0]!.closingValue).toBeUndefined();
    expect(xnt.totals.closingValue).toBeUndefined();
    const xntWithCost = await xntReport(prisma, cost, T(0), T(20));
    expect(xntWithCost.rows[0]).toMatchObject({ openingValue: "0", inValue: "2000000", outValue: "600000", closingValue: "1400000" });
    expect(xntWithCost.totals).toMatchObject({ openingValue: "0", inValue: "2000000", outValue: "600000", closingValue: "1400000" });
  });

  it("tab tồn kho chỉ trả giá/lớp cho actor có quyền; số lượng luôn đúng", async () => {
    const w = await newWorld();
    await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 12_500, T(0), 1));
    const noCost = await productStock(prisma, { userId: w.userId, perms: new Set(["stock.view"]) }, w.p.id);
    expect(noCost).toMatchObject({ onHand: "10", pending: "0" });
    expect(noCost.stockValue).toBeUndefined();
    expect(noCost.layers[0]!.unitCost).toBeUndefined();
    const cost = await productStock(prisma, { userId: w.userId, perms: new Set(["stock.view", "cost.view", "purchase_price.view"]) }, w.p.id);
    expect(cost).toMatchObject({ stockValue: "125000", lastPurchasePrice: "12500" });
    expect(cost.layers[0]!.unitCost).toBe("12500");
  });

  it("XNT và thẻ kho phân trang vẫn giữ số dư đúng trong khoảng thời gian đã chọn", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 10_000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 3, T(10), 1));
    const actor = { userId: w.userId, perms: new Set(["stock.view"]) };
    const card = await stockCardList(prisma, actor, w.p.id, { from: T(5), to: T(20), page: 1, pageSize: 1 });
    expect(card).toMatchObject({ total: 1 });
    expect(card.rows[0]).toMatchObject({ qtyOut: "3", balance: "7" });
    const xnt = await xntList(prisma, actor, { from: T(0), to: T(20), q: w.p.code, page: 1, pageSize: 1 });
    expect(xnt).toMatchObject({ total: 1 });
    expect(xnt.rows[0]).toMatchObject({ opening: "0", inQty: "10", outQty: "3", closing: "7" });
  });
});
