import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, engine, layersOf, newWorld, saleRow, sell, T } from "./helpers";
import { assertChainExact } from "./reference";

beforeEach(resetDb);

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Tổng giá vốn thực tế đã xuất (Σ qty × giá lớp) — không được lệch quá 1 đồng so với tiền nhập. */
async function consumedCost(productId: number) {
  const rows = await prisma.costConsumption.findMany({ where: { layer: { productId } } });
  return rows.reduce((s, r) => s.plus(r.qty.times(r.unitCost)), D(0));
}

describe("làm tròn: sổ luôn cân, tổng vốn không lệch quá 1 đồng", () => {
  it("lô 3 md giá 10.000/3: bán 1 rồi bán 2 → tổng vốn ≈ 10.000 (lệch ≤ 1đ)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 3, D(10000).div(3), T(0), 1));
    expect((await layersOf(w.p.id))[0]!.unitCost.toString()).toBe("3333.3333");
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 1, T(10), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 2, T(11), 2));
    expect((await saleRow(1)).unitCostOut.toString()).toBe("3333.3333");
    expect(D(10000).minus(await consumedCost(w.p.id)).abs().lte(1)).toBe(true);
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("0");
    await assertLedgerBalanced(w.p.id, w.periodId);
    await assertChainExact(w);
  });

  it("1.000 kg ÷ 3 = 333,333 md (3 chữ số lẻ): bán hết → tổng vốn ≈ tiền nhập", async () => {
    const w = await newWorld();
    const run = engine(w);
    const total = D(1_000_000);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, "333.333", total.div("333.333"), T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, "333.333", T(5), 1));
    expect(total.minus(await consumedCost(w.p.id)).abs().lte(1)).toBe(true);
    await assertLedgerBalanced(w.p.id, w.periodId);
    await assertChainExact(w);
  });

  it("3.000 kg ÷ 2,4 = 1.250 md đúng; bán 1 md giữ 3 chữ số lẻ (0,001 md)", async () => {
    const w = await newWorld();
    const run = engine(w);
    const qty = D(3000).div("2.4");
    expect(qty.toString()).toBe("1250");
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, qty, D(50_000_000).div(qty), T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, "0.001", T(5), 1));
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("1249.999");
    await assertLedgerBalanced(w.p.id, w.periodId);
    await assertChainExact(w);
  });

  it("nhiều lần bán lẻ trên lô lẻ (7 lô lẻ, 41 lần bán) không tích luỹ lệch sổ", async () => {
    const w = await newWorld();
    const run = engine(w);
    const costs = ["3333.3333", "1234.5678", "999.9999", "1500.5", "20444.4444", "7", "0.3333"];
    for (let i = 0; i < 7; i++) await run([w.p.id], (ctx) => buy(ctx, w.p.id, "13.333", costs[i]!, T(i), i + 1));
    for (let i = 0; i < 41; i++) await run([w.p.id], (ctx) => sell(ctx, w.p.id, "2.2", T(20 + i), i + 1));
    await assertLedgerBalanced(w.p.id, w.periodId);
    const left = (await layersOf(w.p.id)).reduce((s, l) => s.plus(l.qtyRemaining), D(0));
    const prov = (await prisma.stockLedger.aggregate({ _sum: { qtyProvisional: true } }))._sum.qtyProvisional ?? D(0);
    // 7×13,333 = 93,331 nhập; 41×2,2 = 90,2 xuất
    expect(left.minus(prov).toString()).toBe("3.131");
    await assertChainExact(w);
  });
});
