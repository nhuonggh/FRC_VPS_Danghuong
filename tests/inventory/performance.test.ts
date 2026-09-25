import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { postReceipt, removeDocument, updateLayerCost } from "@/server/inventory/ports";
import { markDirty, withInventoryTx, type WithInventoryOptions } from "@/server/inventory/unit-of-work";
import type { EngineCtx } from "@/server/inventory/types";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, engine, newWorld, sell, T, type World, useNoopCostOwners } from "./helpers";
import { assertChainExact, dbState, referenceState } from "./reference";

/*
 * Hiệu năng là hợp đồng (spec 3.5: tính lại đồng bộ tới ~2.000 dòng). Ngưỡng thời gian ở đây RỘNG (máy dev Windows +
 * Postgres Docker, CI chậm) để không chập chờn; phần chặn hồi quy CHÍNH XÁC là SỐ CÂU LỆNH SQL — không phụ thuộc máy:
 * một lần tính lại N dòng không được tốn O(N) câu lệnh ở phần lan truyền / ghi kết quả (N+1).
 */

beforeEach(resetDb);
useNoopCostOwners(); // các test này không kiểm cột giá vốn dòng chứng từ

/** Client riêng đếm mọi câu lệnh SQL (sự kiện `query` của Prisma). */
const counted = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
let queries = 0;
counted.$on("query", () => { queries++; });
beforeAll(async () => { await counted.$connect(); }); // thời gian kết nối không tính vào phép đo đầu tiên
afterAll(async () => { await counted.$disconnect(); });

type Opts = Partial<Pick<WithInventoryOptions, "inlineLimit">>;
/** Chạy 1 giao dịch kho trên client đếm; trả thời gian (ms) + số câu lệnh SQL. */
async function measure(w: World, products: number[], work: (ctx: EngineCtx) => Promise<unknown>, opts: Opts = {}) {
  queries = 0;
  const t0 = performance.now();
  await withInventoryTx(counted as unknown as PrismaClient, { periodId: w.periodId, userId: w.userId, products, ...opts }, work);
  return { ms: Math.round(performance.now() - t0), queries };
}

/** Nạp nhanh `n` dòng bán THÔ (giá 0, chưa tính) cho mã hàng, mỗi phút một dòng từ T(1); docId = docLineId = 1000 + g. */
async function rawSales(w: World, productId: number, n: number, qty = 5, docBase = 1000) {
  await prisma.$executeRawUnsafe(`
    INSERT INTO stock_ledger ("periodId","productId","docType","docId","docLineId","qtyIn","qtyOut","unitCostOut","qtyProvisional","at","createdBy")
    SELECT ${w.periodId}, ${productId}, 'SALE'::stock_doc_type, g + ${docBase}, g + ${docBase}, 0, ${qty}, 0, 0,
           TIMESTAMPTZ '2026-09-01 00:00:00+00' + (g || ' minutes')::interval, ${w.userId}
      FROM generate_series(1, ${n}) g`);
}

describe("hiệu năng engine (hợp đồng spec 3.5)", () => {
  it("tính lại ĐẦY ĐỦ 2.000 dòng bán; bán ở ĐUÔI chuỗi 2.000 dòng; số câu lệnh không tỉ lệ số dòng", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1_000_000, 100, T(0), 1));
    await rawSales(w, w.p.id, 2000);

    const full = await measure(w, [w.p.id], async (ctx) => markDirty(ctx, w.p.id, T(0)), { inlineLimit: 5000 });
    console.info(`[perf] tính lại 2.000 dòng: ${full.ms} ms, ${full.queries} câu lệnh`);
    expect(full.ms, "tính lại đầy đủ 2.000 dòng (hợp đồng ≤ 3 s)").toBeLessThan(3_000);
    expect(full.queries, "số câu lệnh khi tính lại 2.000 dòng (N+1?)").toBeLessThan(40);
    await assertLedgerBalanced(w.p.id, w.periodId);
    // (assertChainExact ép tính lại từ đầu với ngưỡng mặc định 2.000 → 2.001 sự kiện sẽ bị hoãn nền; so thẳng mô hình)
    expect(await dbState(w.p.id, w.periodId)).toEqual(await referenceState(w.p.id, w.periodId));

    const tail = await measure(w, [w.p.id], (ctx) => sell(ctx, w.p.id, 5, T(5000), 1));
    console.info(`[perf] bán ở đuôi chuỗi 2.000 dòng: ${tail.ms} ms, ${tail.queries} câu lệnh`);
    expect(tail.ms, "bán ở đuôi").toBeLessThan(500);
    expect(tail.queries, "bán ở đuôi không đọc lại cả chuỗi theo từng dòng").toBeLessThan(40);
  }, 120_000);

  it("1.500 đơn TREO (bán âm kho, mỗi đơn một thời điểm) rồi nhập bù: giá tạm không tốn câu lệnh theo từng đơn", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1)); // chỉ đủ cho 2 đơn đầu
    await rawSales(w, w.p.id, 1500);
    const pend = await measure(w, [w.p.id], async (ctx) => markDirty(ctx, w.p.id, T(0)));
    console.info(`[perf] tính lại 1.500 dòng (1.498 treo): ${pend.ms} ms, ${pend.queries} câu lệnh`);
    expect(pend.queries, "giá tạm cho đơn treo nạp lớp thường 1 lần, không 2 câu lệnh/đơn").toBeLessThan(40);
    expect((await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE", docId: 2500 } })).qtyProvisional.toString()).toBe("5");

    const fill = await measure(w, [w.p.id], (ctx) => buy(ctx, w.p.id, 1_000_000, 200, T(3000), 2));
    console.info(`[perf] nhập bù 1.498 đơn treo: ${fill.ms} ms, ${fill.queries} câu lệnh`);
    expect(fill.ms).toBeLessThan(3_000);
    expect(fill.queries).toBeLessThan(40);
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", qtyProvisional: { gt: 0 } } })).toBe(0);
    await assertChainExact(w);
  }, 120_000);

  it("sửa đơn ở ĐẦU chuỗi 500 dòng (mọi dòng sau đổi giá vốn)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1000, 100, T(0), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1_000_000, 200, T(0), 2));
    await rawSales(w, w.p.id, 500);
    await run([w.p.id], async (ctx) => markDirty(ctx, w.p.id, T(0)));
    // Hủy lô đầu → cả 500 dòng đổi giá vốn (100 → 200)
    const edit = await measure(w, [w.p.id], (ctx) => removeDocument(ctx, "PURCHASE", 1));
    console.info(`[perf] hủy lô đầu chuỗi 500 dòng: ${edit.ms} ms, ${edit.queries} câu lệnh`);
    expect(edit.ms).toBeLessThan(3_000);
    expect(edit.queries).toBeLessThan(40);
    await assertChainExact(w);
  }, 120_000);

  it("NHIỀU mã hàng trong một giao dịch: đổi giá phiếu nhập 50 dòng (50 mã × 40 dòng bán)", async () => {
    const w = await newWorld(50);
    const ids = w.products.map((p) => p.id);
    await engine(w)(ids, async (ctx) => {
      for (const [i, id] of ids.entries()) {
        await postReceipt(ctx, { productId: id, qty: 1000, unitCost: 100, docType: "PURCHASE", docId: 1, docLineId: i + 1, at: T(0) });
      }
    });
    for (const [i, id] of ids.entries()) await rawSales(w, id, 40, 5, 1000 + i * 100);
    await engine(w)(ids, async (ctx) => { for (const id of ids) markDirty(ctx, id, T(0)); });

    const r = await measure(w, ids, (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 120 }));
    console.info(`[perf] đổi giá phiếu nhập 50 mã × 40 dòng: ${r.ms} ms, ${r.queries} câu lệnh`);
    expect(r.ms).toBeLessThan(8_000);
    // ~ hằng số câu lệnh MỖI MÃ (tính lại + lan truyền theo lô), không theo mỗi dòng bán
    expect(r.queries / ids.length, "câu lệnh / mã hàng").toBeLessThan(25);
    for (const id of [ids[0]!, ids[49]!]) await assertChainExact(w, id);
  }, 120_000);

  it("lan truyền giá qua lớp PHỤ THUỘC: 300 đơn bán, mỗi đơn có phiếu trả; đổi giá lô đầu", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1_000_000, 100, T(0), 1));
    await rawSales(w, w.p.id, 300, 2);
    await run([w.p.id], async (ctx) => markDirty(ctx, w.p.id, T(0)));
    await run([w.p.id], async (ctx) => {
      for (let g = 1; g <= 300; g++) {
        await postReceipt(ctx, {
          productId: w.p.id, qty: 1, unitCost: 0, docType: "RETURN_IN", docId: 5000 + g, docLineId: 5000 + g, at: T(g + 1000),
          costRef: { docType: "SALE", docLineId: 1000 + g, qty: 2 },
        });
      }
    });
    const r = await measure(w, [w.p.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 150 }));
    console.info(`[perf] đổi giá lô đầu, 300 dòng bán có lớp trả hàng: ${r.ms} ms, ${r.queries} câu lệnh`);
    expect(r.ms).toBeLessThan(3_000);
    expect(r.queries).toBeLessThan(40);
    const ret = await prisma.costLayer.findFirstOrThrow({ where: { sourceDocType: "RETURN_IN", sourceDocId: 5300 } });
    expect(ret.unitCost.toString()).toBe("150");
    await assertChainExact(w);
  }, 120_000);
});
