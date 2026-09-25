import { beforeEach, describe, expect, it } from "vitest";
import { getOnHand } from "@/server/inventory/queries";
import { productsOfDocument, removeDocument } from "@/server/inventory/ports";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, engine, layersOf, newWorld, saleRow, sell, T, type World } from "./helpers";
import { assertChainExact } from "./reference";

beforeEach(resetDb);

// Chuỗi chuẩn: L1 100@20.000 (T0) → S1 30 (T10) → L2 100@22.000 (T20) → S2 90 (T30)
async function chain(w: World) {
  const run = engine(w);
  await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
  await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
  await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 22000, T(20), 2));
  await run([w.p.id], (ctx) => sell(ctx, w.p.id, 90, T(30), 2));
  return run;
}

describe("sửa đơn GIỮA chuỗi (kỳ mở) — hoàn lớp rồi tính lại chuỗi từ điểm sửa", () => {
  it("sửa S1 từ 30 lên 50 → giá vốn S2 tính lại: 50@20.000 + 40@22.000 = 20.888,89", async () => {
    const w = await newWorld();
    const run = await chain(w);
    await run(await productsOfDocument(prisma, "SALE", 1), async (ctx) => {
      await removeDocument(ctx, "SALE", 1);
      await sell(ctx, w.p.id, 50, T(10), 1); // đăng lại cùng thời điểm, số lượng mới
    });
    expect((await saleRow(1)).unitCostOut.toString()).toBe("20000");
    expect((await saleRow(2)).unitCostOut.toFixed(4)).toBe("20888.8889");
    const [l1, l2] = await layersOf(w.p.id);
    expect([l1!.qtyRemaining.toString(), l2!.qtyRemaining.toString()]).toEqual(["0", "60"]);
    await assertLedgerBalanced(w.p.id, w.periodId);
    await assertChainExact(w);
  });

  it("sửa S1 GIẢM từ 30 xuống 10 → S2 ăn nhiều lớp cũ hơn", async () => {
    const w = await newWorld();
    const run = await chain(w);
    await run([w.p.id], async (ctx) => { await removeDocument(ctx, "SALE", 1); await sell(ctx, w.p.id, 10, T(10), 1); });
    // S2: L1 còn 90 → 90@20.000 → 20.000
    expect((await saleRow(2)).unitCostOut.toString()).toBe("20000");
    await assertLedgerBalanced(w.p.id, w.periodId);
    await assertChainExact(w);
  });
});

describe("hủy đơn giữa chuỗi → hoàn kho đúng lớp", () => {
  it("hủy S1 → S2 ăn hết từ L1: giá vốn 20.000; tồn tăng lại", async () => {
    const w = await newWorld();
    const run = await chain(w);
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1));
    expect((await saleRow(2)).unitCostOut.toString()).toBe("20000");
    const [l1, l2] = await layersOf(w.p.id);
    expect([l1!.qtyRemaining.toString(), l2!.qtyRemaining.toString()]).toEqual(["10", "100"]);
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("110");
    await assertLedgerBalanced(w.p.id, w.periodId);
    await assertChainExact(w);
  });

  it("hủy S2 (đơn cuối) → lớp trả lại đúng số đã ăn", async () => {
    const w = await newWorld();
    const run = await chain(w);
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 2));
    const [l1, l2] = await layersOf(w.p.id);
    expect([l1!.qtyRemaining.toString(), l2!.qtyRemaining.toString()]).toEqual(["70", "100"]);
    await assertLedgerBalanced(w.p.id, w.periodId);
    await assertChainExact(w);
  });
});

describe("khôi phục đơn đã hủy — xuất lại tại VỊ TRÍ THỜI GIAN GỐC (spec 34)", () => {
  it("hủy S1 rồi khôi phục (đăng lại tại T10) → mọi con số trở về y như trước khi hủy", async () => {
    const w = await newWorld();
    const run = await chain(w);
    const before = [(await saleRow(1)).unitCostOut.toString(), (await saleRow(2)).unitCostOut.toString()];
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(2)).unitCostOut.toString()]).toEqual(before);
    expect((await saleRow(2)).unitCostOut.toFixed(2)).toBe("20444.44");
    await assertLedgerBalanced(w.p.id, w.periodId);
    await assertChainExact(w);
  });

  it("khôi phục khi TỒN KHÔNG ĐỦ → thành đơn treo (spec 3.3), không lỗi", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 50, 100, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 50, T(10), 1));
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 40, T(20), 2)); // hàng đã được bán tiếp
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 50, T(10), 1)); // khôi phục đơn 1 tại T10 (trước đơn 2)
    expect((await saleRow(1)).qtyProvisional.toString()).toBe("0"); // đơn 1 (T10) nay đứng trước → đủ hàng
    expect((await saleRow(2)).qtyProvisional.toString()).toBe("40"); // đơn 2 (T20) thành đơn treo
    await assertLedgerBalanced(w.p.id, w.periodId);
    await assertChainExact(w);
  });
});

describe("hủy PHIẾU NHẬP giữa chuỗi", () => {
  it("hủy L1 khi S1, S2 đã ăn nó → các đơn thành treo rồi được lớp L2 nuốt theo thứ tự thời gian", async () => {
    const w = await newWorld();
    const run = await chain(w);
    await run([w.p.id], (ctx) => removeDocument(ctx, "PURCHASE", 1));
    const s1 = await saleRow(1);
    const s2 = await saleRow(2);
    expect(s1.qtyProvisional.toString()).toBe("0"); // L2 (T20) nuốt 30 của S1 (T10)
    expect(s2.qtyProvisional.toString()).toBe("20"); // còn 70 → S2 thiếu 20
    expect(s1.unitCostOut.toString()).toBe("22000");
    expect(s2.unitCostOut.toString()).toBe("22000"); // 70@22.000 + 20 tạm@22.000
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("-20");
    await assertLedgerBalanced(w.p.id, w.periodId);
    await assertChainExact(w);
  });

  it("nhập lùi ngày (chèn L0 trước mọi đơn) → mọi giá vốn phía sau tính lại theo lớp mới", async () => {
    const w = await newWorld();
    const run = await chain(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 50, 10000, T(-5), 3));
    // Thứ tự lớp: L0 50@10.000, L1 100@20.000, L2 100@22.000 → S1(30) = 30@10.000
    expect((await saleRow(1)).unitCostOut.toString()).toBe("10000");
    // S2(90): 20@10.000 + 70@20.000 = 1.600.000/90
    expect((await saleRow(2)).unitCostOut.toFixed(4)).toBe("17777.7778");
    await assertLedgerBalanced(w.p.id, w.periodId);
    await assertChainExact(w);
  });
});
