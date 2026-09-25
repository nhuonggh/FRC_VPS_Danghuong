import { beforeEach, describe, expect, it } from "vitest";
import { clearCostOwners, registerCostOwner, unitCostOf, type LineCostSnapshot } from "@/server/inventory/owners";
import { postIssue, postReceipt, removeDocument, updateLayerCost } from "@/server/inventory/ports";
import { DependentDocumentsError } from "@/server/inventory/errors";
import type { EngineCtx } from "@/server/inventory/types";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, engine, layersOf, newWorld, saleRow, sell, T, registerNoopCostOwners, type World } from "./helpers";
import { assertChainExact, dbState, referenceState } from "./reference";

/* Plan 02 Task 7 — giá vốn phụ thuộc chéo (spec 3.4, 3.6). Quy ước gọi engine cho các plan sau:
 *  - trả hàng theo đơn: postReceipt RETURN_IN, costRef { SALE, dòng bán gốc, SL dòng bán gốc };
 *  - bán hàng gia công có BOM (tôn xốp): mỗi NVL 1 postIssue SALE cùng docLineId; chủ dòng nhận tổng vốn NVL;
 *  - lệnh SX phụ kiện: NVL postIssue PRODUCTION_USE, thành phẩm postReceipt PRODUCTION_OUT costRef { PRODUCTION_USE }.
 * Mọi kịch bản kết thúc bằng assertChainExact trên TỪNG mã (mô hình tham chiếu mô phỏng chung bao đóng NVL → thành
 * phẩm, tự suy giá lớp phụ thuộc khác mã — không đọc giá engine đã tính). */

beforeEach(async () => {
  await resetDb();
  clearCostOwners();
  registerNoopCostOwners(); // test không đăng ký chủ dòng SALE thì khai báo rõ: chủ dòng rỗng
});

const checkAll = async (w: World) => { for (const p of w.products) await assertChainExact(w, p.id); };

describe("trả hàng theo đơn: nhập lại kho đúng giá vốn dòng bán gốc (spec 3.4)", () => {
  async function chainWithSale(w: World) {
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 22000, T(20), 2));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 90, T(30), 2)); // vốn 20.444,4444
    return run;
  }
  const returnOfSale2 = (w: World, qty: number, unitCost: Parameters<typeof postReceipt>[1]["unitCost"]) =>
    engine(w)([w.p.id], (ctx) => postReceipt(ctx, {
      productId: w.p.id, qty, unitCost, docType: "RETURN_IN", docId: 1, docLineId: 1, at: T(40),
      costRef: { docType: "SALE", docLineId: 2, qty: 90 },
    }));

  it("trả 10 của dòng bán #2 → lớp mới 10@20.444,4444 (giá vốn CŨ, không phải giá vốn hiện tại)", async () => {
    const w = await newWorld();
    await chainWithSale(w);
    const s2 = await saleRow(2);
    await returnOfSale2(w, 10, s2.unitCostOut);
    const ret = (await layersOf(w.p.id)).find((l) => l.sourceDocType === "RETURN_IN")!;
    expect(ret.unitCost.toString()).toBe("20444.4444");
    expect(ret.qtyRemaining.toString()).toBe("10");
    await checkAll(w);
  });

  it("giá vốn dòng bán ĐỔI (do cước nhập thêm vào lô cũ) → lớp trả hàng TỰ cập nhật theo, và đơn bán sau nó tính lại", async () => {
    const w = await newWorld();
    const run = await chainWithSale(w);
    await returnOfSale2(w, 10, (await saleRow(2)).unitCostOut);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 5, T(50), 3)); // L2 còn 80 (đứng trước lớp trả hàng) → ăn L2
    expect((await saleRow(3)).unitCostOut.toString()).toBe("22000");

    // Cước 500/md phát sinh thêm cho lô L2 (22.000 → 22.500)
    await run([w.p.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 2, unitCost: 22500 }));
    // S2 = (70×20.000 + 20×22.500)/90 = 20.555,5556
    expect((await saleRow(2)).unitCostOut.toString()).toBe("20555.5556");
    // lớp trả hàng phụ thuộc S2 → cập nhật theo
    const ret = (await layersOf(w.p.id)).find((l) => l.sourceDocType === "RETURN_IN")!;
    expect(ret.unitCost.toString()).toBe("20555.5556");
    expect((await saleRow(3)).unitCostOut.toString()).toBe("22500");
    await checkAll(w);
  });

  it("đơn bán ăn LỚP TRẢ HÀNG (tồn thường đã hết) → giá lô gốc đổi lan tới cả đơn bán đó", async () => {
    const w = await newWorld();
    const run = await chainWithSale(w);
    await returnOfSale2(w, 10, 0); // giá người gọi truyền bị thay bằng giá dòng gốc (20.444,4444)
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 84, T(50), 3)); // 80 L2 @22.000 + 4 lớp trả @20.444,4444
    // (80×22.000 + 4×20.444,4444)/84 = 1.841.777,7776/84 = 21.925,9259
    expect((await saleRow(3)).unitCostOut.toString()).toBe("21925.9259");
    await run([w.p.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 2, unitCost: 22500 }));
    // (80×22.500 + 4×20.555,5556)/84 = 1.882.222,2224/84 = 22.407,4074
    expect((await saleRow(3)).unitCostOut.toString()).toBe("22407.4074");
    await checkAll(w);
  });

  it("KHÔNG cho hủy/sửa dòng bán còn có chứng từ trả hàng dựa vào nó", async () => {
    const w = await newWorld();
    const run = await chainWithSale(w);
    await returnOfSale2(w, 10, 20444.4444);
    await expect(run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 2))).rejects.toThrow(DependentDocumentsError);
    expect((await saleRow(2)).unitCostOut.toFixed(2)).toBe("20444.44"); // không đổi gì
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", docId: 2 } })).toBe(1);
    await checkAll(w);
  });
});

describe("tôn xốp: giá vốn dòng bán = TỔNG vốn NVL theo định mức (spec 3.6)", () => {
  it("bán 100 md tôn xốp = xuất tôn cuộn + giấy bạc + POLY (FIFO từng NVL) → chủ dòng nhận tổng vốn; 45.500/md", async () => {
    const w = await newWorld(3);
    const [cuon, giay, poly] = w.products;
    const snaps = new Map<number, LineCostSnapshot>();
    registerCostOwner("SALE", async (_tx, s) => { snaps.set(s.docLineId, s); });
    const run = engine(w);
    await run([cuon!.id, giay!.id, poly!.id], async (ctx) => {
      await buy(ctx, cuon!.id, 200, 30000, T(0), 1);
      await buy(ctx, giay!.id, 500, 2000, T(0), 2);
      await buy(ctx, poly!.id, 300, 25000, T(0), 3);
    });
    // Đơn #9, dòng bán #91: 100 md tôn xốp ⇒ NVL: 120 (tôn cuộn) + 100 (giấy bạc) + 30 (POLY)
    await run([cuon!.id, giay!.id, poly!.id], async (ctx) => {
      for (const [p, q] of [[cuon!, 120], [giay!, 100], [poly!, 30]] as const) {
        await postIssue(ctx, { productId: p.id, qty: q, docType: "SALE", docId: 9, docLineId: 91, at: T(10) });
      }
    });
    const snap = snaps.get(91)!;
    // 120×30.000 + 100×2.000 + 30×25.000 = 3.600.000 + 200.000 + 750.000
    expect(snap.totalCost.toString()).toBe("4550000");
    expect(unitCostOf(snap.totalCost, 100).toString()).toBe("45500");
    expect(snap.qtyProvisional.toString()).toBe("0");
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", docLineId: 91 } })).toBe(3);
    await checkAll(w);
  });

  it("thiếu NVL → dòng bán thành đơn treo (qtyProvisional > 0) và chủ dòng biết", async () => {
    const w = await newWorld(2);
    const [a, b] = w.products;
    const snaps = new Map<number, LineCostSnapshot>();
    registerCostOwner("SALE", async (_tx, s) => { snaps.set(s.docLineId, s); });
    const run = engine(w);
    await run([a!.id, b!.id], async (ctx) => { await buy(ctx, a!.id, 10, 100, T(0), 1); await buy(ctx, b!.id, 2, 50, T(0), 2); });
    await run([a!.id, b!.id], async (ctx) => {
      await postIssue(ctx, { productId: a!.id, qty: 5, docType: "SALE", docId: 9, docLineId: 91, at: T(5) });
      await postIssue(ctx, { productId: b!.id, qty: 5, docType: "SALE", docId: 9, docLineId: 91, at: T(5) }); // thiếu 3
    });
    expect(snaps.get(91)!.qtyProvisional.toString()).toBe("3");
    // phần treo của b tạm tính giá nhập gần nhất (50): 5×100 + 5×50
    expect(snaps.get(91)!.totalCost.toString()).toBe("750");
    await checkAll(w);
  });

  it("giá lô NVL đổi → tổng vốn dòng bán tôn xốp cập nhật (chủ dòng được gọi lại)", async () => {
    const w = await newWorld(2);
    const [a, b] = w.products;
    const snaps = new Map<number, LineCostSnapshot>();
    registerCostOwner("SALE", async (_tx, s) => { snaps.set(s.docLineId, s); });
    const run = engine(w);
    await run([a!.id, b!.id], async (ctx) => { await buy(ctx, a!.id, 100, 100, T(0), 1); await buy(ctx, b!.id, 100, 10, T(0), 2); });
    await run([a!.id, b!.id], async (ctx) => {
      await postIssue(ctx, { productId: a!.id, qty: 10, docType: "SALE", docId: 9, docLineId: 91, at: T(5) });
      await postIssue(ctx, { productId: b!.id, qty: 10, docType: "SALE", docId: 9, docLineId: 91, at: T(5) });
    });
    expect(snaps.get(91)!.totalCost.toString()).toBe("1100");
    await run([a!.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 120 }));
    expect(snaps.get(91)!.totalCost.toString()).toBe("1300"); // 10×120 + 10×10
    await checkAll(w);
  });
});

describe("lệnh sản xuất phụ kiện: giá vốn thành phẩm = tổng vốn NVL / SL (spec 3.6)", () => {
  async function produce(w: World) {
    const [tonCuon, giay, phuKien] = w.products;
    const run = engine(w);
    await run([tonCuon!.id, giay!.id], async (ctx) => {
      await buy(ctx, tonCuon!.id, 100, 30000, T(0), 1);
      await buy(ctx, giay!.id, 100, 2000, T(0), 2);
    });
    // Lệnh SX #7: dùng 10 tôn cuộn + 20 giấy bạc → 5 phụ kiện (NVL ghi TRƯỚC thành phẩm — DerivedLayerOrderError nếu ngược)
    await run([tonCuon!.id, giay!.id, phuKien!.id], async (ctx) => {
      await postIssue(ctx, { productId: tonCuon!.id, qty: 10, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: T(10) });
      await postIssue(ctx, { productId: giay!.id, qty: 20, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: T(10) });
      await postReceipt(ctx, {
        productId: phuKien!.id, qty: 5, unitCost: 68000, docType: "PRODUCTION_OUT", docId: 7, docLineId: 7, at: T(10),
        costRef: { docType: "PRODUCTION_USE", docLineId: 7, qty: 5 },
      });
    });
    return { run, tonCuon: tonCuon!, giay: giay!, phuKien: phuKien! };
  }

  it("lớp thành phẩm có giá vốn = (10×30.000 + 20×2.000)/5 = 68.000; bán 2 phụ kiện → vốn 68.000", async () => {
    const w = await newWorld(3);
    const { run, phuKien } = await produce(w);
    expect((await layersOf(phuKien.id))[0]!.unitCost.toString()).toBe("68000");
    await run([phuKien.id], (ctx) => sell(ctx, phuKien.id, 2, T(20), 1));
    expect((await saleRow(1)).unitCostOut.toString()).toBe("68000");
    await checkAll(w);
  });

  it("GIÁ NVL ĐỔI (cước nhập thêm) → giá vốn thành phẩm cập nhật → giá vốn đơn bán phụ kiện tính lại (lan truyền chéo 2 mã)", async () => {
    const w = await newWorld(3);
    const { run, tonCuon, phuKien } = await produce(w);
    await run([phuKien.id], (ctx) => sell(ctx, phuKien.id, 2, T(20), 1));
    // chỉ khai báo mã NVL: engine tự khoá thêm mã thành phẩm khi lan truyền
    await run([tonCuon.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 31000 }));
    // thành phẩm: (10×31.000 + 20×2.000)/5 = 70.000
    expect((await layersOf(phuKien.id))[0]!.unitCost.toString()).toBe("70000");
    expect((await saleRow(1)).unitCostOut.toString()).toBe("70000");
    await checkAll(w);
  });

  it("hủy lệnh SX: phải hủy THÀNH PHẨM trước rồi mới hủy dòng dùng NVL; hủy sai thứ tự bị chặn", async () => {
    const w = await newWorld(3);
    const { run, tonCuon, giay, phuKien } = await produce(w);
    const all = [tonCuon.id, giay.id, phuKien.id];
    await expect(run(all, (ctx) => removeDocument(ctx, "PRODUCTION_USE", 7))).rejects.toThrow(DependentDocumentsError);
    await run(all, async (ctx) => {
      await removeDocument(ctx, "PRODUCTION_OUT", 7);
      await removeDocument(ctx, "PRODUCTION_USE", 7);
    });
    expect(await prisma.costLayer.count({ where: { productId: phuKien.id } })).toBe(0);
    expect((await layersOf(tonCuon.id))[0]!.qtyRemaining.toString()).toBe("100");
    expect((await layersOf(giay.id))[0]!.qtyRemaining.toString()).toBe("100");
    for (const p of w.products) await assertLedgerBalanced(p.id, w.periodId);
    await checkAll(w);
  });

  it("SỬA lệnh SX trong 1 giao dịch (gỡ thành phẩm → gỡ NVL → ghi lại NVL → ghi lại thành phẩm): giữ seq, giá mới lan tới đơn bán", async () => {
    const w = await newWorld(3);
    const { run, tonCuon, giay, phuKien } = await produce(w);
    await run([phuKien.id], (ctx) => sell(ctx, phuKien.id, 2, T(20), 1));
    const before = await prisma.stockLedger.findMany({ where: { docId: 7 }, orderBy: { seq: "asc" } });
    const all = [tonCuon.id, giay.id, phuKien.id];
    // Định mức sửa: 10 tôn cuộn + 40 giấy bạc → 5 phụ kiện: (300.000 + 80.000)/5 = 76.000
    await run(all, async (ctx) => {
      await removeDocument(ctx, "PRODUCTION_OUT", 7);
      await removeDocument(ctx, "PRODUCTION_USE", 7);
      await postIssue(ctx, { productId: tonCuon.id, qty: 10, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: T(10) });
      await postIssue(ctx, { productId: giay.id, qty: 40, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: T(10) });
      await postReceipt(ctx, {
        productId: phuKien.id, qty: 5, unitCost: 0, docType: "PRODUCTION_OUT", docId: 7, docLineId: 7, at: T(10),
        costRef: { docType: "PRODUCTION_USE", docLineId: 7, qty: 5 },
      });
    });
    const after = await prisma.stockLedger.findMany({ where: { docId: 7 }, orderBy: { seq: "asc" } });
    expect(after.map((r) => [r.docType, r.productId, r.seq])).toEqual(before.map((r) => [r.docType, r.productId, r.seq]));
    expect((await layersOf(phuKien.id))[0]!.unitCost.toString()).toBe("76000");
    expect((await saleRow(1)).unitCostOut.toString()).toBe("76000");
    await checkAll(w);
  });

  it("mô hình tham chiếu TỰ suy giá thành phẩm từ NVL (không đọc giá engine): giá thành phẩm + đơn bán bị sửa lệch nhất quán trong DB vẫn bị bắt", async () => {
    const w = await newWorld(3);
    const { run, phuKien } = await produce(w);
    await run([phuKien.id], (ctx) => sell(ctx, phuKien.id, 2, T(20), 1));
    expect(await dbState(phuKien.id, w.periodId)).toEqual(await referenceState(phuKien.id, w.periodId));
    // Lệch "tự nhất quán": lớp, consumption và dòng bán cùng 69.000 — oracle cũ (lấy giá DB cho lớp khác mã) sẽ chấp nhận
    const layer = (await layersOf(phuKien.id))[0]!;
    await prisma.costLayer.update({ where: { id: layer.id }, data: { unitCost: 69000 } });
    await prisma.costConsumption.updateMany({ where: { layerId: layer.id }, data: { unitCost: 69000 } });
    await prisma.stockLedger.updateMany({ where: { docType: "SALE", docId: 1 }, data: { unitCostOut: 69000 } });
    expect(await dbState(phuKien.id, w.periodId)).not.toEqual(await referenceState(phuKien.id, w.periodId));
  });

  // Quyết định engine (docs/engine-fifo.md §2.2): lớp phụ thuộc KHÔNG nhập bù đơn treo
  it("bán phụ kiện TRƯỚC khi sản xuất (âm kho) → thành phẩm KHÔNG lấp đơn treo; đơn bán sau lệnh SX ăn thành phẩm", async () => {
    const w = await newWorld(3);
    const phuKien = w.products[2]!;
    const run = engine(w);
    await run([phuKien.id], (ctx) => sell(ctx, phuKien.id, 2, T(5), 1)); // chưa có phụ kiện nào → treo 2 @0
    await produce(w); // mua NVL T0 + lệnh SX #7 T10 → 5 @68.000
    const s1 = await saleRow(1);
    expect([s1.unitCostOut.toString(), s1.qtyProvisional.toString()]).toEqual(["0", "2"]);
    const out = (await layersOf(phuKien.id))[0]!;
    expect([out.unitCost.toString(), out.qtyRemaining.toString()]).toEqual(["68000", "5"]);
    await run([phuKien.id], (ctx) => sell(ctx, phuKien.id, 3, T(20), 2));
    expect((await saleRow(2)).unitCostOut.toString()).toBe("68000");
    expect((await saleRow(1)).qtyProvisional.toString()).toBe("2"); // vẫn treo tới khi có nhập THƯỜNG
    await checkAll(w);
  });
});

/** Lệnh SX số n tại `at`: NVL ghi TRƯỚC, rồi thành phẩm (costRef PRODUCTION_USE n). */
async function productionOrder(ctx: EngineCtx, n: number, at: Date, uses: [number, number][], out: [number, number]) {
  for (const [productId, qty] of uses) await postIssue(ctx, { productId, qty, docType: "PRODUCTION_USE", docId: n, docLineId: n, at });
  await postReceipt(ctx, {
    productId: out[0], qty: out[1], unitCost: 0, docType: "PRODUCTION_OUT", docId: n, docLineId: n, at,
    costRef: { docType: "PRODUCTION_USE", docLineId: n, qty: out[1] },
  });
}
const outLayer = async (productId: number, n: number) =>
  (await layersOf(productId)).find((l) => l.sourceDocType === "PRODUCTION_OUT" && l.sourceDocId === n)!.unitCost.toString();

describe("lan truyền nhiều tầng / nhiều nhánh (review Task 7)", () => {
  it("BOM 2 tầng M → bán thành phẩm S → thành phẩm F: đổi giá M lan tới S, F và đơn bán F (mô hình duyệt bao đóng bắc cầu)", async () => {
    const w = await newWorld(3);
    const [m, s, f] = w.products.map((p) => p.id) as [number, number, number];
    const run = engine(w);
    await run([m], (ctx) => buy(ctx, m, 100, 1000, T(0), 1));
    await run([m, s], (ctx) => productionOrder(ctx, 7, T(10), [[m, 10]], [s, 5])); // S = 10.000/5 = 2.000
    await run([s, f], (ctx) => productionOrder(ctx, 8, T(20), [[s, 4]], [f, 2])); // F = 4×2.000/2 = 4.000
    await run([f], (ctx) => sell(ctx, f, 1, T(30), 1));
    expect([await outLayer(s, 7), await outLayer(f, 8), (await saleRow(1)).unitCostOut.toString()]).toEqual(["2000", "4000", "4000"]);
    await run([m], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 1100 }));
    expect([await outLayer(s, 7), await outLayer(f, 8), (await saleRow(1)).unitCostOut.toString()]).toEqual(["2200", "4400", "4400"]);
    await checkAll(w);
  });

  it("CÙNG NVL cho hai lệnh SX / hai thành phẩm: FIFO NVL chia lô giữa hai lệnh; đổi giá lô cũ → cả hai thành phẩm tính lại", async () => {
    const w = await newWorld(3);
    const [m, f1, f2] = w.products.map((p) => p.id) as [number, number, number];
    const run = engine(w);
    await run([m], async (ctx) => { await buy(ctx, m, 10, 100, T(0), 1); await buy(ctx, m, 10, 200, T(1), 2); });
    await run([m, f1], (ctx) => productionOrder(ctx, 7, T(10), [[m, 8]], [f1, 4])); // 8@100 → 200
    await run([m, f2], (ctx) => productionOrder(ctx, 8, T(11), [[m, 8]], [f2, 2])); // (2@100 + 6@200)/2 = 700
    expect([await outLayer(f1, 7), await outLayer(f2, 8)]).toEqual(["200", "700"]);
    await run([m], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 150 }));
    expect([await outLayer(f1, 7), await outLayer(f2, 8)]).toEqual(["300", "750"]); // 1.200/4; (300 + 1.200)/2
    await checkAll(w);
  });

  it("đổi giá HAI NVL của cùng lệnh SX trong MỘT giao dịch → thành phẩm = hai giá mới", async () => {
    const w = await newWorld(3);
    const [m1, m2, f] = w.products.map((p) => p.id) as [number, number, number];
    const run = engine(w);
    await run([m1, m2], async (ctx) => { await buy(ctx, m1, 100, 30000, T(0), 1); await buy(ctx, m2, 100, 2000, T(0), 2); });
    await run([m1, m2, f], (ctx) => productionOrder(ctx, 7, T(10), [[m1, 10], [m2, 20]], [f, 5]));
    await run([f], (ctx) => sell(ctx, f, 2, T(20), 1));
    await run([m1, m2], async (ctx) => {
      await updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 31000 });
      await updateLayerCost(ctx, { docType: "PURCHASE", docId: 2, unitCost: 2500 });
    });
    expect([await outLayer(f, 7), (await saleRow(1)).unitCostOut.toString()]).toEqual(["72000", "72000"]); // (310.000 + 50.000)/5
    await checkAll(w);
  });

  it("trả hàng của đơn bán đã ăn lớp THÀNH PHẨM (phụ thuộc chồng phụ thuộc): đổi giá NVL → thành phẩm → đơn bán → lớp trả → đơn bán sau", async () => {
    const w = await newWorld(3);
    const [m1, m2, f] = w.products.map((p) => p.id) as [number, number, number];
    const run = engine(w);
    await run([m1, m2], async (ctx) => { await buy(ctx, m1, 100, 1000, T(0), 1); await buy(ctx, m2, 100, 10, T(0), 2); });
    await run([m1, m2, f], (ctx) => productionOrder(ctx, 7, T(10), [[m1, 10], [m2, 10]], [f, 5])); // (10.000 + 100)/5 = 2.020
    await run([f], (ctx) => sell(ctx, f, 2, T(20), 1));
    await run([f], (ctx) => postReceipt(ctx, {
      productId: f, qty: 1, unitCost: 0, docType: "RETURN_IN", docId: 1, docLineId: 1, at: T(30),
      costRef: { docType: "SALE", docLineId: 1, qty: 2 },
    }));
    await run([f], (ctx) => sell(ctx, f, 4, T(40), 2)); // 3 thành phẩm + 1 hàng trả
    const ret = async () => (await layersOf(f)).find((l) => l.sourceDocType === "RETURN_IN")!.unitCost.toString();
    expect([await ret(), (await saleRow(2)).unitCostOut.toString()]).toEqual(["2020", "2020"]);
    await run([m1], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 1500 }));
    // thành phẩm (15.000 + 100)/5 = 3.020 → đơn #1 3.020 → lớp trả 3.020 → đơn #2 3.020
    expect([await outLayer(f, 7), (await saleRow(1)).unitCostOut.toString(), await ret(), (await saleRow(2)).unitCostOut.toString()])
      .toEqual(["3020", "3020", "3020", "3020"]);
    await expect(run([f], (ctx) => removeDocument(ctx, "SALE", 1))).rejects.toThrow(DependentDocumentsError);
    await checkAll(w);
  });

  it("tháo dỡ F → M CÙNG `at` với lệnh SX M → F (vòng mã M→F→M): ghi sau nên hợp lệ, hội tụ; đổi giá M lan vòng mà không chu trình", async () => {
    const w = await newWorld(2);
    const [m, f] = w.products.map((p) => p.id) as [number, number];
    const run = engine(w);
    await run([m], (ctx) => buy(ctx, m, 100, 1000, T(0), 1));
    await run([m, f], async (ctx) => {
      await productionOrder(ctx, 7, T(10), [[m, 10]], [f, 5]); // F = 2.000
      await productionOrder(ctx, 8, T(10), [[f, 2]], [m, 4]); // tháo 2 F → 4 M = 4.000/4 = 1.000
    });
    await run([m], (ctx) => sell(ctx, m, 92, T(20), 1)); // 90 lô mua + 2 hàng tháo dỡ
    expect([await outLayer(f, 7), await outLayer(m, 8), (await saleRow(1)).unitCostOut.toString()]).toEqual(["2000", "1000", "1000"]);
    await run([m], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 1200 }));
    expect([await outLayer(f, 7), await outLayer(m, 8), (await saleRow(1)).unitCostOut.toString()]).toEqual(["2400", "1200", "1200"]);
    await checkAll(w);
  });
});
