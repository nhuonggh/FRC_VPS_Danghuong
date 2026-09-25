import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EngineInvariantError } from "@/server/inventory/errors";
import { clearCostOwners, registerCostOwner } from "@/server/inventory/owners";
import { postIssue, postReceipt } from "@/server/inventory/ports";
import { docTimestamp } from "@/server/inventory/time";
import type { EngineCtx } from "@/server/inventory/types";
import { markDirty } from "@/server/inventory/unit-of-work";
import { prisma, resetDb } from "../helpers/db";
import { buy, engine, layersOf, newWorld, saleRow, sell, T, type World } from "./helpers";
import { assertChainExact } from "./reference";

beforeEach(resetDb);
afterEach(clearCostOwners);

/* Vòng sửa 3: thứ tự sự kiện tại CÙNG `at` = (1) lớp THƯỜNG, (2) lệnh xuất, (3) lớp PHỤ THUỘC, rồi id.
 * Quy tắc thời gian: lớp phụ thuộc có `at` KHÔNG TRƯỚC dòng gốc (cùng `at` hợp lệ — nó xếp sau lệnh xuất). */

/** Trạng thái chuẩn hoá theo SỐ CHỨNG TỪ, nhiều mã hàng. */
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

describe("bán + trả hàng lùi ngày CÙNG NGÀY (cùng `at` do docTimestamp)", () => {
  it("được chấp nhận, giá đúng, hội tụ, khớp mô hình tham chiếu", async () => {
    const saleAt = docTimestamp("2026-09-10", new Date("2026-09-12T02:00:00Z"));
    const retAt = docTimestamp("2026-09-10", new Date("2026-09-12T03:30:00Z"));
    expect(retAt).toEqual(saleAt); // cùng 23:59:59.999 ICT 10/09
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], async (ctx) => {
      await buy(ctx, w.p.id, 10, 100, T(0), 1);
      await buy(ctx, w.p.id, 10, 200, T(1), 2);
    });
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 15, saleAt, 1)); // 10@100 + 5@200 = 2.000/15 = 133,3333
    await run([w.p.id], (ctx) =>
      postReceipt(ctx, { productId: w.p.id, qty: 6, unitCost: 0, docType: "RETURN_IN", docId: 50, docLineId: 50, at: retAt, costRef: { docType: "SALE", docLineId: 1, qty: 15 } }),
    );
    expect((await saleRow(1)).unitCostOut.toString()).toBe("133.3333");
    const ret = (await layersOf(w.p.id)).find((l) => l.sourceDocType === "RETURN_IN")!;
    // 15 × 133,3333 = 1.999,9995 / 15 = 133,3333
    expect([ret.unitCost.toString(), ret.qtyRemaining.toString()]).toEqual(["133.3333", "6"]);
    await assertChainExact(w);

    // Bán tiếp 10 ngày 11/09: 5@200 (lô 2 còn) + 5@133,3333 (lớp trả) = 1.666,6665/10 = 166,66665 → 166.6667
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, docTimestamp("2026-09-11", new Date("2026-09-12T04:00:00Z")), 2));
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["166.6667", "0"]);
    await assertChainExact(w);
  });

  it("đơn bán KHÁC cùng `at` với lớp trả không ăn lớp trả (xếp trước nó) — ăn lớp thường hoặc treo", async () => {
    const D = docTimestamp("2026-09-10", new Date("2026-09-12T02:00:00Z"));
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, D, 1)); // hết lô
    await run([w.p.id], (ctx) =>
      postReceipt(ctx, { productId: w.p.id, qty: 4, unitCost: 0, docType: "RETURN_IN", docId: 50, docLineId: 50, at: D, costRef: { docType: "SALE", docLineId: 1, qty: 10 } }),
    );
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 3, D, 2)); // cùng `at`, ghi sau lớp trả → vẫn xếp TRƯỚC lớp trả → treo
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["100", "3"]);
    expect((await layersOf(w.p.id)).find((l) => l.sourceDocType === "RETURN_IN")!.qtyRemaining.toString()).toBe("4");
    await assertChainExact(w);
  });
});

describe("gia công lại (rework): dùng và nhập CÙNG mã hàng, CÙNG `at`", () => {
  it("được chấp nhận; thành phẩm = (4×100 + 2×50)/4 = 125", async () => {
    const w = await newWorld(2);
    const [x, y] = w.products;
    const run = engine(w);
    await run([x!.id, y!.id], async (ctx) => {
      await buy(ctx, x!.id, 10, 100, T(0), 1);
      await buy(ctx, y!.id, 10, 50, T(0), 2);
    });
    await run([x!.id, y!.id], async (ctx) => {
      await postIssue(ctx, { productId: x!.id, qty: 4, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: T(5) });
      await postIssue(ctx, { productId: y!.id, qty: 2, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: T(5) });
      await postReceipt(ctx, { productId: x!.id, qty: 4, unitCost: 0, docType: "PRODUCTION_OUT", docId: 7, docLineId: 7, at: T(5), costRef: { docType: "PRODUCTION_USE", docLineId: 7, qty: 4 } });
    });
    const out = (await layersOf(x!.id)).find((l) => l.sourceDocType === "PRODUCTION_OUT")!;
    expect([out.unitCost.toString(), out.qtyRemaining.toString()]).toEqual(["125", "4"]);
    const use = await prisma.stockLedger.findFirstOrThrow({ where: { productId: x!.id, docType: "PRODUCTION_USE" } });
    expect([use.unitCostOut.toString(), use.qtyProvisional.toString()]).toEqual(["100", "0"]); // ăn lô thường, không ăn thành phẩm
    await assertChainExact(w, x!.id);
    await assertChainExact(w, y!.id);
  });
});

/** Hai lệnh SX cùng `at` hoán đổi P/Q: lệnh 1 dùng Q ra P, lệnh 2 dùng P ra Q (vòng BOM). */
async function mutualBom(w: World, firstOrder: 1 | 2) {
  const [p, q] = w.products;
  const run = engine(w);
  await run([p!.id, q!.id], async (ctx) => {
    await buy(ctx, p!.id, 1, 100, T(0), 1);
    await buy(ctx, q!.id, 1, 200, T(0), 2);
  });
  const order = async (ctx: EngineCtx, n: 1 | 2) => {
    const [useP, outP] = n === 1 ? [q!, p!] : [p!, q!];
    await postIssue(ctx, { productId: useP.id, qty: 2, docType: "PRODUCTION_USE", docId: n, docLineId: n, at: T(5) });
    await postReceipt(ctx, { productId: outP.id, qty: 2, unitCost: 0, docType: "PRODUCTION_OUT", docId: n, docLineId: n, at: T(5), costRef: { docType: "PRODUCTION_USE", docLineId: n, qty: 2 } });
  };
  await run([p!.id, q!.id], async (ctx) => {
    await order(ctx, firstOrder);
    await order(ctx, firstOrder === 1 ? 2 : 1);
  });
  return { p: p!, q: q! };
}

describe("vòng BOM cùng `at` (P→Q, Q→P) — không còn chu trình", () => {
  it("hội tụ nhanh: USE Q = 1@200 + 1 treo @200 → P = 200; USE P = 1@100 + 1 treo @100 → Q = 100", async () => {
    let calls = 0;
    registerCostOwner("PRODUCTION_USE", async () => {
      if (++calls > 30) throw new Error(`chủ dòng bị gọi ${calls} lần — không hội tụ nhanh`);
    });
    const w = await newWorld(2);
    const { p, q } = await mutualBom(w, 1);
    const use1 = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "PRODUCTION_USE", docLineId: 1 } });
    const use2 = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "PRODUCTION_USE", docLineId: 2 } });
    expect([use1.unitCostOut.toString(), use1.qtyProvisional.toString()]).toEqual(["200", "1"]);
    expect([use2.unitCostOut.toString(), use2.qtyProvisional.toString()]).toEqual(["100", "1"]);
    const outP = (await layersOf(p.id)).find((l) => l.sourceDocType === "PRODUCTION_OUT")!;
    const outQ = (await layersOf(q.id)).find((l) => l.sourceDocType === "PRODUCTION_OUT")!;
    expect([outP.unitCost.toString(), outP.qtyRemaining.toString()]).toEqual(["200", "2"]);
    expect([outQ.unitCost.toString(), outQ.qtyRemaining.toString()]).toEqual(["100", "2"]);
    await assertChainExact(w, p.id);
    await assertChainExact(w, q.id);
  });

  it("không phụ thuộc thứ tự ghi: lệnh 2 trước lệnh 1 → từng dòng giống hệt", async () => {
    const w1 = await newWorld(2);
    const a = await mutualBom(w1, 1);
    const s1 = await docState([a.p.id, a.q.id]);
    await resetDb();
    const w2 = await newWorld(2);
    const b = await mutualBom(w2, 2);
    // id mã hàng giống nhau sau resetDb (RESTART IDENTITY) → so trực tiếp
    expect([b.p.id, b.q.id]).toEqual([a.p.id, a.q.id]);
    expect(await docState([b.p.id, b.q.id])).toEqual(s1);
  });
});

describe("lưới an toàn: không để lỗi không hội tụ biến thành timeout 30s", () => {
  async function seedDerived(w: World, productId: number, n: number) {
    await engine(w)([productId], async (ctx) => {
      await buy(ctx, productId, n, 10, T(0), 1);
      for (let i = 1; i <= n; i++) {
        await sell(ctx, productId, 1, T(i), i);
        await postReceipt(ctx, { productId, qty: 1, unitCost: 0, docType: "RETURN_IN", docId: 10_000 + i, docLineId: 10_000 + i, at: T(i), costRef: { docType: "SALE", docLineId: i, qty: 1 } });
      }
    });
  }

  it("≈200 lớp phụ thuộc ở mã B; chủ dòng tổng hợp lặp trên mã A (0 lớp phụ thuộc) → bị chặn ở ngưỡng 50 trong vài giây", async () => {
    const w = await newWorld(2);
    const [a, b] = w.products;
    await seedDerived(w, b!.id, 200);
    expect(await prisma.costLayer.count({ where: { costRefType: { not: null } } })).toBe(200);
    const started = Date.now();
    const err = await engine(w)([a!.id], async (ctx) => {
      registerCostOwner("SALE", async () => { markDirty(ctx, a!.id, T(0)); });
      await buy(ctx, a!.id, 10, 5, T(0), 9001);
      await sell(ctx, a!.id, 1, T(1), 9001);
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineInvariantError);
    expect((err as Error).message).toMatch(/không hội tụ/);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 120_000);

  it("≈200 lớp phụ thuộc ở CHÍNH mã đang lặp → ngân sách thời gian flush chặn với lỗi rõ ràng (không phải timeout transaction)", async () => {
    const w = await newWorld();
    await seedDerived(w, w.p.id, 200);
    const started = Date.now();
    const err = await engine(w)([w.p.id], async (ctx) => {
      registerCostOwner("SALE", async () => { markDirty(ctx, w.p.id, T(0)); });
      markDirty(ctx, w.p.id, T(0));
    }, { flushBudgetMs: 2_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineInvariantError);
    expect((err as Error).message).toMatch(/không hội tụ|quá thời gian/);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await prisma.costLayer.count({ where: { costRefType: { not: null } } })).toBe(200); // rollback, dữ liệu cũ còn nguyên
  }, 120_000);
});
