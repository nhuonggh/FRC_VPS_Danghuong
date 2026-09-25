import { beforeEach, describe, expect, it } from "vitest";
import { getOnHand } from "@/server/inventory/queries";
import { clearCostOwners, registerCostOwner, type LineCostSnapshot } from "@/server/inventory/owners";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, consOf, engine, layersOf, newWorld, saleRow, sell, T, registerNoopCostOwners } from "./helpers";

beforeEach(async () => {
  await resetDb();
  clearCostOwners();
  registerNoopCostOwners(); // test không đăng ký chủ dòng SALE thì khai báo rõ: chủ dòng rỗng
});

describe("bán âm kho → đơn treo → nhập bù (spec 3.3)", () => {
  it("không có tồn: vẫn xuất; provisional = toàn bộ; giá tạm 0; tồn ÂM; báo cho chủ dòng là 'đơn treo'", async () => {
    const w = await newWorld();
    const snaps: LineCostSnapshot[] = [];
    registerCostOwner("SALE", async (_tx, s) => { snaps.push(s); });
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 50, T(10), 1));
    const s = await saleRow(1);
    expect(s.qtyProvisional.toString()).toBe("50");
    expect(s.unitCostOut.toString()).toBe("0");
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("-50");
    expect(snaps.at(-1)!.qtyProvisional.toString()).toBe("50");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("NHẬP BÙ: tạo lớp → khớp đơn treo, tính lại giá vốn, gỡ cờ, báo chủ dòng", async () => {
    const w = await newWorld();
    const snaps: LineCostSnapshot[] = [];
    registerCostOwner("SALE", async (_tx, s) => { snaps.push(s); });
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 50, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10000, T(20), 1));
    const s = await saleRow(1);
    expect(s.qtyProvisional.toString()).toBe("0");
    expect(s.unitCostOut.toString()).toBe("10000");
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("50");
    expect(snaps.at(-1)).toMatchObject({ docLineId: 1 });
    expect(snaps.at(-1)!.qtyProvisional.toString()).toBe("0");
    expect(snaps.at(-1)!.totalCost.toString()).toBe("500000");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("giá tạm = giá nhập GẦN NHẤT; sau nhập bù giá vốn thật là bình quân lớp cũ + lớp bù", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 8000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 150, T(10), 1)); // thiếu 50
    let s = await saleRow(1);
    expect(s.qtyProvisional.toString()).toBe("50");
    expect(s.unitCostOut.toString()).toBe("8000"); // 100@8000 + 50 tạm@8000
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 9000, T(20), 2));
    s = await saleRow(1);
    expect(s.qtyProvisional.toString()).toBe("0");
    expect(s.unitCostOut.toString()).toBe("8333.3333"); // (100×8000 + 50×9000)/150
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("nhập bù TỪNG PHẦN: đơn treo giảm dần theo từng lần nhập", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 100, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 30, 100, T(20), 1));
    expect((await saleRow(1)).qtyProvisional.toString()).toBe("70");
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 30, 200, T(21), 2));
    expect((await saleRow(1)).qtyProvisional.toString()).toBe("40");
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 50, 300, T(22), 3));
    const s = await saleRow(1);
    expect(s.qtyProvisional.toString()).toBe("0");
    expect(s.unitCostOut.toString()).toBe("210"); // (30×100 + 30×200 + 40×300)/100
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("nhiều đơn treo được khớp theo thứ tự THỜI GIAN (cũ trước)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 40, T(10), 1)); // treo cũ
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 40, T(11), 2)); // treo mới
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 60, 100, T(20), 1));
    expect((await saleRow(1)).qtyProvisional.toString()).toBe("0"); // đơn cũ đủ
    expect((await saleRow(2)).qtyProvisional.toString()).toBe("20"); // đơn mới còn thiếu 20
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("bán sau khi đã nhập bù dùng phần lớp còn lại", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 50, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10000, T(20), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 40, T(30), 2));
    expect((await saleRow(2)).unitCostOut.toString()).toBe("10000");
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("10");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("đơn treo lập TRƯỚC ngày nhập nhưng nhập bù ghi SAU vẫn được khớp (lớp ở tương lai của đơn)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, T(5), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 50, T(50), 1)); // lớp dated sau đơn
    expect((await consOf((await saleRow(1)).id)).length).toBe(1);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });
});
