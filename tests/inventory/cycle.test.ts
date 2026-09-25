import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EngineInvariantError, ProductNotLockedError } from "@/server/inventory/errors";
import { clearCostOwners, registerCostOwner, unitCostOf } from "@/server/inventory/owners";
import { postReceipt, updateLayerCost } from "@/server/inventory/ports";
import { getOnHand } from "@/server/inventory/queries";
import type { EngineCtx } from "@/server/inventory/types";
import { markDirty } from "@/server/inventory/unit-of-work";
import { prisma, resetDb } from "../helpers/db";
import { buy, consOf, engine, layersOf, newWorld, saleRow, sell, T } from "./helpers";
import { assertChainExact } from "./reference";

beforeEach(resetDb);
afterEach(clearCostOwners);

/* Vòng sửa 1: lớp phụ thuộc (costRef) KHÔNG cấp hàng cho chính dòng gốc của nó → đồ thị phụ thuộc giá là DAG. */

const ret998 = (ctx: EngineCtx, productId: number) =>
  postReceipt(ctx, { productId, qty: 998, unitCost: 0, docType: "RETURN_IN", docId: 50, docLineId: 50, at: T(30), costRef: { docType: "SALE", docLineId: 1, qty: 1000 } });

/** Trạng thái chuẩn hoá theo SỐ CHỨNG TỪ (không theo id) để so 2 thế giới khác nhau. */
async function docState(productId: number) {
  const layers = await prisma.costLayer.findMany({ where: { productId } });
  const byLayer = new Map(layers.map((l) => [l.id, `${l.sourceDocType}#${l.sourceDocId}`]));
  const outs = await prisma.stockLedger.findMany({ where: { productId, qtyOut: { gt: 0 } } });
  const byOut = new Map(outs.map((o) => [o.id, `${o.docType}#${o.docLineId}`]));
  const cons = await prisma.costConsumption.findMany({ where: { ledger: { productId } } });
  return {
    layers: layers.map((l) => `${byLayer.get(l.id)}:${l.qtyRemaining.toString()}:${l.unitCost.toString()}`).sort(),
    outs: outs.map((o) => `${byOut.get(o.id)}:${o.unitCostOut.toString()}:${o.qtyProvisional.toString()}`).sort(),
    cons: cons.map((c) => `${byOut.get(c.ledgerId)}<-${byLayer.get(c.layerId)}:${c.qty.toString()}:${c.unitCost.toString()}`).sort(),
  };
}

describe("lớp trả hàng ↔ dòng bán gốc đang treo: không chu trình", () => {
  it("kịch bản review: 1@100, bán 1000, 1@300, trả 998 của chính dòng bán → hội tụ ngay; bán 100,2, lớp trả 100,2", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1, 100, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 1000, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1, 300, T(20), 2));
    // (1×100 + 1×300 + 998 tạm × 100)/1000 = 100.200/1000
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["100.2", "998"]);

    let calls = 0;
    registerCostOwner("SALE", async () => {
      if (++calls > 20) throw new Error(`chủ dòng bị gọi ${calls} lần — flush không hội tụ nhanh`);
    });
    await run([w.p.id], (ctx) => ret998(ctx, w.p.id));
    expect(calls).toBeLessThanOrEqual(3);
    const s = await saleRow(1);
    // lớp trả KHÔNG nuốt phần treo của chính dòng bán → dòng bán giữ nguyên; lớp trả = giá dòng bán = 100,2
    expect([s.unitCostOut.toString(), s.qtyProvisional.toString()]).toEqual(["100.2", "998"]);
    expect((await consOf(s.id)).map((c) => [c.qty.toString(), c.unitCost.toString()])).toEqual([["1", "100"], ["1", "300"]]);
    const ret = (await layersOf(w.p.id)).find((l) => l.sourceDocType === "RETURN_IN")!;
    expect([ret.unitCost.toString(), ret.qtyRemaining.toString()]).toEqual(["100.2", "998"]);
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("0");
    await assertChainExact(w);

    // Nhập bù 998@50 → dòng bán nuốt lớp MỚI (bỏ qua lớp trả của chính nó dù lớp trả cũ hơn):
    // (100 + 300 + 998×50)/1000 = 50.300/1000 = 50,3 → lớp trả lan truyền 50,3; lớp trả vẫn còn 998
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 998, 50, T(40), 3));
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["50.3", "0"]);
    const ret2 = (await layersOf(w.p.id)).find((l) => l.sourceDocType === "RETURN_IN")!;
    expect([ret2.unitCost.toString(), ret2.qtyRemaining.toString()]).toEqual(["50.3", "998"]);
    await assertChainExact(w);

    // Đơn bán KHÁC ăn lớp trả bình thường (FIFO: lớp trả T30 trước lớp T40)
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, T(50), 2));
    expect((await saleRow(2)).unitCostOut.toString()).toBe("50.3");
    await assertChainExact(w);
  });

  it("không phụ thuộc lịch sử: trả hàng TRƯỚC rồi mới nhập lùi ngày 1@300 == thứ tự tự nhiên", async () => {
    const orderA = async () => {
      const w = await newWorld();
      const run = engine(w);
      await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1, 100, T(0), 1));
      await run([w.p.id], (ctx) => sell(ctx, w.p.id, 1000, T(10), 1));
      await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1, 300, T(20), 2));
      await run([w.p.id], (ctx) => ret998(ctx, w.p.id));
      await assertChainExact(w);
      return docState(w.p.id);
    };
    const orderB = async () => {
      const w = await newWorld();
      const run = engine(w);
      await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1, 100, T(0), 1));
      await run([w.p.id], (ctx) => sell(ctx, w.p.id, 1000, T(10), 1));
      await run([w.p.id], (ctx) => ret998(ctx, w.p.id)); // lúc này dòng bán = 100 → lớp trả 100
      await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1, 300, T(20), 2)); // lùi ngày → bán 100,2 → lan truyền lớp trả
      await assertChainExact(w);
      return docState(w.p.id);
    };
    const a = await orderA();
    await resetDb();
    const b = await orderB();
    expect(b).toEqual(a);
    expect(a.layers).toContain("RETURN_IN#50:998:100.2");
  });

  it("trả hàng của dòng bán ĐÃ GIAO ĐỦ (không treo) giữ nguyên hợp đồng Task 7: đổi giá lô → dòng bán + lớp trả = 20.555,5556", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 22000, T(20), 2));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 90, T(30), 2));
    const s2 = await saleRow(2);
    await run([w.p.id], (ctx) => postReceipt(ctx, {
      productId: w.p.id, qty: 10, unitCost: s2.unitCostOut, docType: "RETURN_IN", docId: 1, docLineId: 1, at: T(40),
      costRef: { docType: "SALE", docLineId: 2, qty: 90 },
    }));
    const ret = async () => (await layersOf(w.p.id)).find((l) => l.sourceDocType === "RETURN_IN")!;
    expect([(await ret()).unitCost.toString(), (await ret()).qtyRemaining.toString()]).toEqual(["20444.4444", "10"]);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 5, T(50), 3));
    await run([w.p.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 2, unitCost: 22500 }));
    // (70×20.000 + 20×22.500)/90 = 1.850.000/90 = 20.555,5555… → 20555.5556
    expect((await saleRow(2)).unitCostOut.toString()).toBe("20555.5556");
    expect((await ret()).unitCost.toString()).toBe("20555.5556");
    expect((await saleRow(3)).unitCostOut.toString()).toBe("22500"); // L2 còn 80 → ăn L2
    await assertChainExact(w);
  });

  it("lớp trả hàng VẪN nuốt đơn treo của dòng KHÁC", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], async (ctx) => {
      await buy(ctx, w.p.id, 5, 100, T(0), 1);
      await buy(ctx, w.p.id, 5, 200, T(1), 2);
    });
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, T(5), 1)); // (500 + 1000)/10 = 150
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 5, T(10), 2)); // treo 5, giá tạm 200
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["200", "5"]);
    await run([w.p.id], (ctx) =>
      postReceipt(ctx, { productId: w.p.id, qty: 4, unitCost: 0, docType: "RETURN_IN", docId: 60, docLineId: 60, at: T(20), costRef: { docType: "SALE", docLineId: 1, qty: 10 } }),
    );
    // lớp trả 4@150 nuốt dòng bán #2: (4×150 + 1 tạm × 200)/5 = 800/5 = 160
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["150", "0"]);
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["160", "1"]);
    const ret = (await layersOf(w.p.id)).find((l) => l.sourceDocType === "RETURN_IN")!;
    expect([ret.unitCost.toString(), ret.qtyRemaining.toString()]).toEqual(["150", "0"]);
    await assertChainExact(w);
  });
});

describe("lớp trả hàng đến khi dòng gốc ĐỨNG TRƯỚC trong hàng đợi treo", () => {
  it("bỏ qua dòng gốc (vẫn treo) nhưng VẪN nuốt đơn treo đứng SAU nó", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], async (ctx) => {
      await buy(ctx, w.p.id, 1, 100, T(0), 1);
      await buy(ctx, w.p.id, 1, 400, T(1), 2);
    });
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, T(5), 1)); // (100 + 400 + 8 tạm × 400)/10 = 3.700/10 = 370
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 3, T(6), 2)); // treo 3 @400
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["370", "8"]);
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["400", "3"]);
    await run([w.p.id], (ctx) =>
      postReceipt(ctx, { productId: w.p.id, qty: 5, unitCost: 0, docType: "RETURN_IN", docId: 70, docLineId: 70, at: T(10), costRef: { docType: "SALE", docLineId: 1, qty: 10 } }),
    );
    // lớp trả 5@370: dòng #1 (gốc) bị bỏ qua, dòng #2 nuốt 3@370; lớp trả còn 2
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["370", "8"]);
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["370", "0"]);
    const ret = (await layersOf(w.p.id)).find((l) => l.sourceDocType === "RETURN_IN")!;
    expect([ret.unitCost.toString(), ret.qtyRemaining.toString()]).toEqual(["370", "2"]);
    await assertChainExact(w);
  });
});

describe("flush: lưới an toàn chu trình", () => {
  it("chủ dòng tổng hợp cứ đánh dấu dirty lại → EngineInvariantError 'không hội tụ' nhanh, rollback", async () => {
    const w = await newWorld();
    const started = Date.now();
    const err = await engine(w)([w.p.id], async (ctx) => {
      registerCostOwner("SALE", async () => { markDirty(ctx, w.p.id, T(0)); });
      await buy(ctx, w.p.id, 10, 5, T(0), 1);
      await sell(ctx, w.p.id, 1, T(1), 1);
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineInvariantError);
    expect((err as Error).message).toMatch(/không hội tụ/);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await prisma.stockLedger.count()).toBe(0);
  });

  it("ngưỡng tính THEO MÃ HÀNG: 60 mã trong 1 giao dịch (vd kiểm kho) vẫn chạy", async () => {
    const w = await newWorld(60);
    const ids = w.products.map((p) => p.id);
    await engine(w)(ids, async (ctx) => {
      for (const [i, id] of ids.entries()) await buy(ctx, id, 1, 10, T(0), i + 1);
    });
    expect(await prisma.costLayer.count()).toBe(60);
  });
});

describe("rào chắn gọi sai", () => {
  it("postReceipt costRef trỏ dòng của mã hàng CHƯA khoá → ProductNotLockedError; khoá đủ thì chạy", async () => {
    const w = await newWorld(2);
    const [a, b] = w.products;
    const run = engine(w);
    await run([b!.id], async (ctx) => {
      await buy(ctx, b!.id, 10, 7, T(0), 1);
      await sell(ctx, b!.id, 4, T(1), 7);
    });
    const post = (ctx: EngineCtx) => postReceipt(ctx, {
      productId: a!.id, qty: 2, unitCost: 0, docType: "PRODUCTION_OUT", docId: 7, docLineId: 7, at: T(2), costRef: { docType: "SALE", docLineId: 7, qty: 2 },
    });
    await expect(run([a!.id], post)).rejects.toThrow(ProductNotLockedError);
    await run([a!.id, b!.id], post);
    expect((await layersOf(a!.id))[0]!.unitCost.toString()).toBe("14"); // 4×7/2
  });

  it("KHÔNG lồng withInventoryTx trong work → EngineInvariantError, rollback cả giao dịch ngoài", async () => {
    const w = await newWorld();
    const run = engine(w);
    const err = await run([w.p.id], async (ctx) => {
      await buy(ctx, w.p.id, 1, 1, T(0), 1);
      await run([w.p.id], async () => undefined);
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineInvariantError);
    expect((err as Error).message).toMatch(/lồng withInventoryTx/);
    expect(await prisma.stockLedger.count()).toBe(0);
    // sau lỗi, gọi tuần tự bình thường vẫn được
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1, 1, T(0), 1));
    expect(await prisma.stockLedger.count()).toBe(1);
  });

  it("owners re-export unitCostOf (HALF_UP 4 số)", () => {
    expect(unitCostOf("1840000", "90").toString()).toBe("20444.4444");
    expect(unitCostOf("1850000", "90").toString()).toBe("20555.5556");
  });
});
