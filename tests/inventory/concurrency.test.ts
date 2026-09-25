import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, engine, layersOf, newWorld, sell, T } from "./helpers";

beforeEach(resetDb);

describe("ghi đồng thời cùng mã hàng (spec 3.0)", () => {
  it("2 người bán cùng lúc 60 + 60 trên tồn 100 → không ăn trùng lớp; đúng 20 treo; người bán trước theo thời gian được đủ", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10, T(0), 1));
    await Promise.all([
      run([w.p.id], (ctx) => sell(ctx, w.p.id, 60, T(10), 1)),
      run([w.p.id], (ctx) => sell(ctx, w.p.id, 60, T(11), 2)),
    ]);
    const rows = await prisma.stockLedger.findMany({ where: { docType: "SALE" }, orderBy: { docId: "asc" } });
    expect(rows.map((r) => r.qtyProvisional.toString())).toEqual(["0", "20"]);
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("0");
    const consumed = await prisma.costConsumption.aggregate({ _sum: { qty: true } });
    expect(consumed._sum.qty!.toString()).toBe("100"); // KHÔNG phải 120
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("10 giao dịch chen nhau (mỗi giao dịch 15) trên tồn 100 → tổng tiêu thụ 100, treo 50, không deadlock", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10, T(0), 1));
    await Promise.all(Array.from({ length: 10 }, (_, i) => run([w.p.id], (ctx) => sell(ctx, w.p.id, 15, T(10 + i), i + 1))));
    const agg = await prisma.stockLedger.aggregate({ where: { docType: "SALE" }, _sum: { qtyProvisional: true } });
    expect(agg._sum.qtyProvisional!.toString()).toBe("50");
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("0");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("giao dịch nhiều mã hàng khai báo thứ tự đảo nhau [a,b] / [b,a] chạy đồng thời không deadlock", async () => {
    const w = await newWorld(2);
    const [a, b] = w.products;
    const run = engine(w);
    await run([a!.id, b!.id], async (ctx) => { await buy(ctx, a!.id, 1000, 10, T(0), 1); await buy(ctx, b!.id, 1000, 20, T(0), 2); });
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      run(i % 2 ? [a!.id, b!.id] : [b!.id, a!.id], async (ctx) => {
        await sell(ctx, a!.id, 5, T(10 + i), 100 + i);
        await sell(ctx, b!.id, 5, T(10 + i), 200 + i);
      }),
    ));
    await assertLedgerBalanced(a!.id, w.periodId);
    await assertLedgerBalanced(b!.id, w.periodId);
    expect((await layersOf(a!.id))[0]!.qtyRemaining.toString()).toBe("960");
    expect((await layersOf(b!.id))[0]!.qtyRemaining.toString()).toBe("960");
  });

  it("2 giao dịch NHẬP và BÁN chen nhau: kết quả vẫn cân sổ", async () => {
    const w = await newWorld();
    const run = engine(w);
    await Promise.all([
      run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1)),
      run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10, T(5), 1)),
    ]);
    await assertLedgerBalanced(w.p.id, w.periodId);
    const row = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE" } });
    expect(row.qtyProvisional.toString()).toBe("0"); // lớp nhập có at sớm hơn dòng bán
  });
});
