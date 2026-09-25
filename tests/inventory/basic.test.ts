import { beforeEach, describe, expect, it } from "vitest";
import { postIssue } from "@/server/inventory/ports";
import { getOnHand } from "@/server/inventory/queries";
import { markDirty } from "@/server/inventory/unit-of-work";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, consOf, engine, layersOf, newWorld, saleRow, sell, T, useNoopCostOwners } from "./helpers";

beforeEach(resetDb);
useNoopCostOwners(); // các test này không kiểm cột giá vốn dòng chứng từ

describe("engine FIFO — nhập/bán cơ bản (spec 3.7)", () => {
  it("nhập 100@20.000 rồi bán 30 → vốn 20.000, còn 70@20.000", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    const s = await saleRow(1);
    expect(s.unitCostOut.toString()).toBe("20000");
    expect(s.qtyProvisional.toString()).toBe("0");
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("70");
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("70");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("TEST CHUẨN CỦA KHÁCH: 100@20.000 → bán 30 → 100@22.000 → bán 90 = 70@20.000 + 20@22.000 ⇒ 20.444,44; còn 80@22.000", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 22000, T(20), 2));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 90, T(30), 2));

    const [l1, l2] = await layersOf(w.p.id);
    expect(l1!.qtyRemaining.toString()).toBe("0");
    expect(l2!.qtyRemaining.toString()).toBe("80");
    expect((await saleRow(1)).unitCostOut.toString()).toBe("20000");
    const s2 = await saleRow(2);
    expect(s2.unitCostOut.toFixed(2)).toBe("20444.44");
    expect(s2.unitCostOut.toString()).toBe("20444.4444"); // (70×20.000 + 20×22.000)/90 = 20444,444… → HALF_UP 4 số
    const cons = await consOf(s2.id);
    expect(cons.map((c) => [c.layerId, c.qty.toString(), c.unitCost.toString()])).toEqual([
      [l1!.id, "70", "20000"],
      [l2!.id, "20", "22000"],
    ]);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("thứ tự lớp theo THỜI GIAN chứ không theo thứ tự ghi: lớp nhập lùi ngày được ăn trước", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 200, T(20), 2)); // ghi trước nhưng ngày muộn
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1)); // ghi sau nhưng ngày sớm
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 15, T(30), 1));
    // 10@100 (lớp ngày sớm) + 5@200
    expect((await saleRow(1)).unitCostOut.toString()).toBe("133.3333");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("2 dòng cùng mã trong MỘT đơn (cùng thời điểm) được ăn lớp tuần tự theo thứ tự ghi", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], async (ctx) => {
      await buy(ctx, w.p.id, 100, 10, T(0), 1);
      await buy(ctx, w.p.id, 100, 12, T(1), 2);
    });
    await run([w.p.id], async (ctx) => {
      await postIssue(ctx, { productId: w.p.id, qty: 60, docType: "SALE", docId: 5, docLineId: 51, at: T(5) });
      await postIssue(ctx, { productId: w.p.id, qty: 70, docType: "SALE", docId: 5, docLineId: 52, at: T(5) });
    });
    const rows = await prisma.stockLedger.findMany({ where: { docId: 5 }, orderBy: { docLineId: "asc" } });
    expect(rows[0]!.unitCostOut.toString()).toBe("10"); // 60@10
    expect(rows[1]!.unitCostOut.toString()).toBe("10.8571"); // (40@10 + 30@12)/70
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("bán hết đúng bằng tồn → lớp về 0, không đơn treo", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 50, 7, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 50, T(1), 1));
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("0");
    expect((await saleRow(1)).qtyProvisional.toString()).toBe("0");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("tính lại là IDEMPOTENT: replay lại từ đầu cho đúng cùng kết quả", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 22000, T(20), 2));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 90, T(30), 2));
    const snap = async () => JSON.stringify({
      cons: await prisma.costConsumption.findMany({ orderBy: [{ ledgerId: "asc" }, { layerId: "asc" }], select: { layerId: true, ledgerId: true, qty: true, unitCost: true } }),
      layers: await layersOf(w.p.id),
      outs: (await prisma.stockLedger.findMany({ where: { qtyOut: { gt: 0 } }, orderBy: { id: "asc" } })).map((r) => [r.id, r.unitCostOut, r.qtyProvisional]),
    });
    const before = await snap();
    await run([w.p.id], async (ctx) => markDirty(ctx, w.p.id, T(0)));
    expect(await snap()).toBe(before);
    await run([w.p.id], async (ctx) => markDirty(ctx, w.p.id, T(25)));
    expect(await snap()).toBe(before);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("lỗi giữa chừng → rollback toàn bộ (không dòng sổ/lớp mồ côi)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await expect(run([w.p.id], async (ctx) => {
      await buy(ctx, w.p.id, 10, 5, T(0), 1);
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await prisma.stockLedger.count()).toBe(0);
    expect(await prisma.costLayer.count()).toBe(0);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("nhiều mã hàng trong 1 giao dịch: mỗi mã tính riêng", async () => {
    const w = await newWorld(2);
    const [a, b] = w.products;
    const run = engine(w);
    await run([a!.id, b!.id], async (ctx) => {
      await buy(ctx, a!.id, 10, 100, T(0), 1);
      await buy(ctx, b!.id, 10, 500, T(0), 2);
    });
    await run([a!.id, b!.id], async (ctx) => {
      await sell(ctx, a!.id, 4, T(5), 10);
      await sell(ctx, b!.id, 5, T(5), 11);
    });
    expect((await saleRow(10)).unitCostOut.toString()).toBe("100");
    expect((await saleRow(11)).unitCostOut.toString()).toBe("500");
    await assertLedgerBalanced(a!.id, w.periodId);
    await assertLedgerBalanced(b!.id, w.periodId);
  });
});
