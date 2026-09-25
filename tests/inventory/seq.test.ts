import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EngineInvariantError } from "@/server/inventory/errors";
import { clearCostOwners } from "@/server/inventory/owners";
import { postIssue, postReceipt, removeDocument } from "@/server/inventory/ports";
import { docTimestamp } from "@/server/inventory/time";
import type { EngineCtx } from "@/server/inventory/types";
import { prisma, resetDb } from "../helpers/db";
import { buy, engine, layersOf, newWorld, saleRow, sell, T, type World } from "./helpers";
import { assertChainExact } from "./reference";

beforeEach(resetDb);
afterEach(clearCostOwners);

/* Vòng sửa 5: khoá thứ tự ổn định `seq` (stock_ledger.seq) — giữ nguyên qua sửa (xoá + ghi lại) như `at`. */

const D = docTimestamp("2026-09-10", new Date("2026-09-12T02:00:00Z"));

/** Trạng thái chuẩn hoá theo SỐ CHỨNG TỪ (không theo id/seq) — so sánh qua các lịch sử sửa khác nhau. */
async function docState(productIds: number[]) {
  const layers = await prisma.costLayer.findMany({ where: { productId: { in: productIds } } });
  const byLayer = new Map(layers.map((l) => [l.id, `${l.productId}/${l.sourceDocType}#${l.sourceLineId}`]));
  const outs = await prisma.stockLedger.findMany({ where: { productId: { in: productIds }, qtyOut: { gt: 0 } } });
  const byOut = new Map(outs.map((o) => [o.id, `${o.productId}/${o.docType}#${o.docLineId}`]));
  const cons = await prisma.costConsumption.findMany({ where: { ledger: { productId: { in: productIds } } } });
  return {
    layers: layers.map((l) => `${byLayer.get(l.id)}:${l.qtyRemaining.toString()}:${l.unitCost.toString()}`).sort(),
    outs: outs.map((o) => `${byOut.get(o.id)}:${o.unitCostOut.toString()}:${o.qtyProvisional.toString()}`).sort(),
    cons: cons.map((c) => `${byOut.get(c.ledgerId)}<-${byLayer.get(c.layerId)}:${c.qty.toString()}:${c.unitCost.toString()}`).sort(),
  };
}

const useX = (ctx: EngineCtx, x: number, seq?: bigint) =>
  postIssue(ctx, { productId: x, qty: 4, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: D, ...(seq === undefined ? {} : { seq }) });
const outF = (ctx: EngineCtx, f: number, seq?: bigint) =>
  postReceipt(ctx, { productId: f, qty: 4, unitCost: 0, docType: "PRODUCTION_OUT", docId: 7, docLineId: 7, at: D, costRef: { docType: "PRODUCTION_USE", docLineId: 7, qty: 4 }, ...(seq === undefined ? {} : { seq }) });
const sellF = (ctx: EngineCtx, f: number, seq?: bigint) =>
  postIssue(ctx, { productId: f, qty: 2, docType: "SALE", docId: 1, docLineId: 1, at: D, ...(seq === undefined ? {} : { seq }) });

async function world2() {
  const w = await newWorld(2);
  const [x, f] = w.products;
  await engine(w)([x!.id, f!.id], (ctx) => buy(ctx, x!.id, 10, 100, T(0), 1));
  return { w, x: x!.id, f: f!.id, all: [x!.id, f!.id] };
}
const check = async (w: World, ids: number[]) => { for (const id of ids) await assertChainExact(w, id); };

describe("schema: stock_ledger.seq", () => {
  it("DB tự cấp seq tăng dần, duy nhất; app_rw ghi được (quyền sequence)", async () => {
    const w = await newWorld();
    const base = { periodId: w.periodId, productId: w.p.id, docType: "PURCHASE" as const, docId: 1, docLineId: 1, at: T(0), createdBy: w.userId, qtyIn: 1 };
    const a = await prisma.stockLedger.create({ data: base });
    const b = await prisma.stockLedger.create({ data: { ...base, docLineId: 2 } });
    expect(typeof a.seq).toBe("bigint");
    expect(b.seq > a.seq).toBe(true);
    await expect(prisma.stockLedger.create({ data: { ...base, docLineId: 3, seq: a.seq } })).rejects.toThrow(/Unique constraint/);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE app_rw");
      await tx.$executeRawUnsafe(
        `INSERT INTO stock_ledger ("periodId","productId","docType","docId","docLineId","qtyIn","at","createdBy") VALUES (${w.periodId}, ${w.p.id}, 'PURCHASE', 9, 9, 1, now(), ${w.userId})`,
      );
    });
    const c = await prisma.stockLedger.findFirstOrThrow({ where: { docId: 9 } });
    expect(c.seq > b.seq).toBe(true);
  });
});

describe("sửa chứng từ cùng `at` giữ nguyên vị trí (seq tự dùng lại trong cùng giao dịch)", () => {
  it("kịch bản re-review vòng 5: sửa lệnh SX 7 sau khi đã bán thành phẩm cùng ngày → bán vẫn 2@100, không treo, F còn 2", async () => {
    const { w, x, f, all } = await world2();
    const run = engine(w);
    const posted = await run(all, async (ctx) => ({ use: await useX(ctx, x), out: await outF(ctx, f) }));
    expect(typeof posted.use.seq).toBe("bigint"); // cổng trả seq để module lưu cùng dòng chứng từ
    expect(typeof posted.out.seq).toBe("bigint");
    await run(all, (ctx) => sellF(ctx, f));
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["100", "0"]);
    const before = await docState(all);

    const seqsBefore = (await prisma.stockLedger.findMany({ where: { docId: 7 }, orderBy: { seq: "asc" } })).map((r) => r.seq);
    await run(all, async (ctx) => {
      await removeDocument(ctx, "PRODUCTION_OUT", 7);
      await removeDocument(ctx, "PRODUCTION_USE", 7);
      await useX(ctx, x);
      await outF(ctx, f);
    });
    const seqsAfter = (await prisma.stockLedger.findMany({ where: { docId: 7 }, orderBy: { seq: "asc" } })).map((r) => r.seq);
    expect(seqsAfter).toEqual(seqsBefore);
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["100", "0"]);
    expect((await layersOf(f))[0]!.qtyRemaining.toString()).toBe("2");
    expect(await docState(all)).toEqual(before);
    await check(w, all);
  });

  it("sửa lớp trả hàng cùng ngày sau khi đã bán lại → đơn bán lại vẫn ăn lớp trả", async () => {
    const w = await newWorld();
    const run = engine(w);
    const ret = (ctx: EngineCtx) =>
      postReceipt(ctx, { productId: w.p.id, qty: 4, unitCost: 0, docType: "RETURN_IN", docId: 50, docLineId: 50, at: D, costRef: { docType: "SALE", docLineId: 1, qty: 10 } });
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, D, 1));
    await run([w.p.id], ret);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 3, D, 2));
    const before = await docState([w.p.id]);
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["100", "0"]);
    await run([w.p.id], async (ctx) => {
      await removeDocument(ctx, "RETURN_IN", 50);
      await ret(ctx);
    });
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["100", "0"]);
    expect(await docState([w.p.id])).toEqual(before);
    await assertChainExact(w);
  });
});

describe("hủy rồi khôi phục QUA HAI giao dịch với seq đã lưu", () => {
  it("bán ghi TRƯỚC thành phẩm cùng `at` (treo) — hủy rồi khôi phục với seq cũ → vẫn treo như trước", async () => {
    const { w, x, f, all } = await world2();
    const run = engine(w);
    let saleSeq = BigInt(0);
    await run(all, async (ctx) => {
      await useX(ctx, x);
      saleSeq = (await sellF(ctx, f)).seq;
      await outF(ctx, f);
    });
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["0", "2"]);
    const before = await docState(all);
    await run(all, (ctx) => removeDocument(ctx, "SALE", 1));
    expect(await prisma.stockLedger.count({ where: { docType: "SALE" } })).toBe(0);
    await run(all, (ctx) => sellF(ctx, f, saleSeq)); // module lưu seq cùng dòng chứng từ, truyền lại khi khôi phục
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["0", "2"]);
    expect((await saleRow(1)).seq).toBe(saleSeq);
    expect(await docState(all)).toEqual(before);
    await check(w, all);
  });

  it("khôi phục KHÔNG truyền seq → nhận seq mới (xếp sau thành phẩm) → ăn thành phẩm — cho thấy phải lưu seq", async () => {
    const { w, x, f, all } = await world2();
    const run = engine(w);
    await run(all, async (ctx) => {
      await useX(ctx, x);
      await sellF(ctx, f);
      await outF(ctx, f);
    });
    await run(all, (ctx) => removeDocument(ctx, "SALE", 1));
    await run(all, (ctx) => sellF(ctx, f));
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["100", "0"]);
    await check(w, all);
  });

  it("sửa đơn bán treo (ghi trước thành phẩm) trong 1 giao dịch → vẫn treo (seq tự dùng lại)", async () => {
    const { w, x, f, all } = await world2();
    const run = engine(w);
    await run(all, async (ctx) => {
      await useX(ctx, x);
      await sellF(ctx, f);
      await outF(ctx, f);
    });
    const before = await docState(all);
    await run(all, async (ctx) => {
      await removeDocument(ctx, "SALE", 1);
      await sellF(ctx, f);
    });
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["0", "2"]);
    expect(await docState(all)).toEqual(before);
    await check(w, all);
  });
});

describe("không phụ thuộc lịch sử sửa (docs §2.3)", () => {
  it("cùng dữ liệu cuối qua hai lịch sử sửa khác nhau → từng dòng giống hệt", async () => {
    const history = async (edits: boolean) => {
      const { w, x, f, all } = await world2();
      const run = engine(w);
      const seqs = await run(all, async (ctx) => {
        const u = await useX(ctx, x);
        const o = await outF(ctx, f);
        return { u: u.seq, o: o.seq };
      });
      const s = await run(all, (ctx) => sellF(ctx, f));
      if (edits) {
        await run(all, async (ctx) => { // sửa lệnh SX (tự dùng lại seq)
          await removeDocument(ctx, "PRODUCTION_OUT", 7);
          await removeDocument(ctx, "PRODUCTION_USE", 7);
          await useX(ctx, x);
          await outF(ctx, f);
        });
        await run(all, (ctx) => removeDocument(ctx, "SALE", 1)); // hủy bán…
        await run(all, (ctx) => sellF(ctx, f, s.seq)); // …khôi phục với seq đã lưu
        await run(all, async (ctx) => { // hủy + khôi phục lệnh SX qua 2 giao dịch với seq đã lưu
          await removeDocument(ctx, "PRODUCTION_OUT", 7);
        });
        await run(all, (ctx) => outF(ctx, f, seqs.o));
      }
      await check(w, all);
      return docState(all);
    };
    const plain = await history(false);
    await resetDb();
    const edited = await history(true);
    expect(edited).toEqual(plain);
  });
});

describe("giá tạm (ước tính) chọn theo thứ tự sự kiện (at, seq), không theo id lớp (Task 4 I1)", () => {
  const buyAt = (ctx: EngineCtx, productId: number, qty: number, unitCost: number, n: number, seq?: bigint) =>
    postReceipt(ctx, { productId, qty, unitCost, docType: "PURCHASE", docId: n, docLineId: n, at: D, ...(seq === undefined ? {} : { seq }) });
  const cost = async () => [(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()];

  /** A 1@100 rồi B 1@200 cùng `at`; bán 5 cùng `at` → ăn A, B; 3 treo @ giá tạm = B (lớp thường cuối theo seq) → 180. */
  async function setup() {
    const w = await newWorld();
    const run = engine(w);
    const a = await run([w.p.id], (ctx) => buyAt(ctx, w.p.id, 1, 100, 1));
    await run([w.p.id], (ctx) => buyAt(ctx, w.p.id, 1, 200, 2));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 5, D, 1));
    expect(await cost()).toEqual(["180", "3"]); // (100 + 200 + 3×200) / 5
    return { w, run, aSeq: a.seq };
  }

  it("sửa phiếu nhập A (xoá + ghi lại cùng giao dịch, seq tự dùng lại) → giá tạm vẫn theo B, bán vẫn 180", async () => {
    const { w, run } = await setup();
    await run([w.p.id], async (ctx) => {
      await removeDocument(ctx, "PURCHASE", 1);
      await buyAt(ctx, w.p.id, 1, 100, 1);
    });
    expect(await cost()).toEqual(["180", "3"]);
    await assertChainExact(w);
  });

  it("hủy phiếu nhập A rồi khôi phục QUA HAI giao dịch với seq đã lưu → bán vẫn 180", async () => {
    const { w, run, aSeq } = await setup();
    await run([w.p.id], (ctx) => removeDocument(ctx, "PURCHASE", 1));
    expect(await cost()).toEqual(["200", "4"]); // chỉ còn B; 4 treo @200
    await run([w.p.id], (ctx) => buyAt(ctx, w.p.id, 1, 100, 1, aSeq));
    expect(await cost()).toEqual(["180", "3"]);
    await assertChainExact(w);
  });

  it("nhánh DỰ PHÒNG (bán trước mọi lớp thường): A rồi B cùng `at`; sửa A (id lớp mới > B) → giá tạm vẫn theo A", async () => {
    // Bán 5 tại T10, TRƯỚC mọi lớp → treo cả 5; A 1@100 và B 1@200 (cùng `at` D, sau T10) lần lượt nuốt 1 + 1.
    // Không có lớp thường ≤ T10 → giá tạm = lớp thường ĐẦU TIÊN theo (at, seq) = A → (100 + 200 + 3×100)/5 = 120.
    // Sửa A cấp id lớp mới LỚN hơn B: nếu nhánh dự phòng sắp theo id lớp sẽ chọn B → 180.
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 5, T(10), 1));
    await run([w.p.id], (ctx) => buyAt(ctx, w.p.id, 1, 100, 1));
    await run([w.p.id], (ctx) => buyAt(ctx, w.p.id, 1, 200, 2));
    expect(await cost()).toEqual(["120", "3"]);
    await run([w.p.id], async (ctx) => {
      await removeDocument(ctx, "PURCHASE", 1);
      await buyAt(ctx, w.p.id, 1, 100, 1);
    });
    const [a, b] = await prisma.costLayer.findMany({ where: { productId: w.p.id }, orderBy: { sourceDocId: "asc" } });
    expect(a!.id > b!.id).toBe(true); // tiền đề: A nay có id lớp lớn hơn B
    expect(await cost()).toEqual(["120", "3"]);
    await assertChainExact(w);
  });
});

describe("seq truyền vào", () => {
  it("seq đã có dòng dùng → EngineInvariantError tiếng Việt, không ghi gì", async () => {
    const w = await newWorld();
    const run = engine(w);
    const { seq } = await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1));
    const err = await run([w.p.id], (ctx) =>
      postIssue(ctx, { productId: w.p.id, qty: 1, docType: "SALE", docId: 1, docLineId: 1, at: T(1), seq }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineInvariantError);
    expect((err as Error).message).toMatch(/\(seq\) \d+ đã được dùng/);
    expect(await prisma.stockLedger.count({ where: { docType: "SALE" } })).toBe(0);
  });

  it("DerivedLayerOrderError so theo seq: dòng gốc ghi SAU (id lớn hơn) nhưng khôi phục với seq NHỎ hơn lớp → hợp lệ", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1));
    const { seq: freeSeq } = await run([w.p.id], (ctx) => sell(ctx, w.p.id, 1, D, 1));
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1)); // seq của dòng bán được giải phóng (lưu ở chứng từ)
    await run([w.p.id], async (ctx) => {
      // lớp trả ghi trước (seq mới, lớn), dòng gốc khôi phục sau trong cùng giao dịch với seq cũ (nhỏ hơn)
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 0, docType: "RETURN_IN", docId: 50, docLineId: 50, at: D, costRef: { docType: "SALE", docLineId: 1, qty: 1 } });
      await postIssue(ctx, { productId: w.p.id, qty: 1, docType: "SALE", docId: 1, docLineId: 1, at: D, seq: freeSeq });
    });
    const ret = (await layersOf(w.p.id)).find((l) => l.sourceDocType === "RETURN_IN")!;
    expect([ret.unitCost.toString(), ret.qtyRemaining.toString()]).toEqual(["100", "1"]);
    await assertChainExact(w);
  });
});
