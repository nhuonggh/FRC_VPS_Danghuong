import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DerivedLayerOrderError, EngineInvariantError, InvalidCostRefTypeError } from "@/server/inventory/errors";
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

/* Vòng sửa 4: thứ tự sự kiện = (at, hạng, khoá): hạng 0 = lớp THƯỜNG (khoá id lớp); hạng 1 = lệnh xuất VÀ lớp PHỤ
 * THUỘC (khoá id dòng sổ = thứ tự ghi). Lớp phụ thuộc: `at` KHÔNG TRƯỚC dòng gốc và được GHI SAU dòng gốc. */

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

  // ĐỔI KỲ VỌNG vòng sửa 4 (ruling mới): tại cùng `at`, lệnh xuất và lớp phụ thuộc xếp theo THỨ TỰ GHI (id dòng sổ) →
  // đơn bán lại ghi SAU lớp trả ăn được lớp trả (vòng 3: treo 3 @100 và lớp trả còn 4).
  it("trả hàng rồi BÁN LẠI cùng ngày lùi (cùng `at`, ghi sau lớp trả) → đơn bán lại ăn lớp trả", async () => {
    const D = docTimestamp("2026-09-10", new Date("2026-09-12T02:00:00Z"));
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, D, 1)); // hết lô
    await run([w.p.id], (ctx) =>
      postReceipt(ctx, { productId: w.p.id, qty: 4, unitCost: 0, docType: "RETURN_IN", docId: 50, docLineId: 50, at: D, costRef: { docType: "SALE", docLineId: 1, qty: 10 } }),
    );
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 3, D, 2)); // cùng `at`, ghi SAU lớp trả → ăn 3@100 của lớp trả
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["100", "0"]);
    expect((await layersOf(w.p.id)).find((l) => l.sourceDocType === "RETURN_IN")!.qtyRemaining.toString()).toBe("1");
    await assertChainExact(w);
  });
});

describe("sản xuất + bán lùi ngày CÙNG NGÀY (kịch bản re-review vòng 4)", () => {
  const D = docTimestamp("2026-09-10", new Date("2026-09-12T02:00:00Z"));
  async function setup(saleFirst: boolean) {
    const w = await newWorld(2);
    const [x, f] = w.products;
    const run = engine(w);
    await run([x!.id, f!.id], (ctx) => buy(ctx, x!.id, 10, 100, T(0), 1));
    await run([x!.id, f!.id], async (ctx) => {
      await postIssue(ctx, { productId: x!.id, qty: 4, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: D });
      if (saleFirst) await sell(ctx, f!.id, 2, D, 1);
      await postReceipt(ctx, { productId: f!.id, qty: 4, unitCost: 0, docType: "PRODUCTION_OUT", docId: 7, docLineId: 7, at: D, costRef: { docType: "PRODUCTION_USE", docLineId: 7, qty: 4 } });
      if (!saleFirst) await sell(ctx, f!.id, 2, D, 1);
    });
    return { w, x: x!, f: f! };
  }

  it("bán thành phẩm ghi SAU lệnh SX cùng `at` → ăn lớp thành phẩm: 2@100, không treo", async () => {
    const { w, x, f } = await setup(false);
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["100", "0"]);
    const out = (await layersOf(f.id))[0]!;
    expect([out.unitCost.toString(), out.qtyRemaining.toString()]).toEqual(["100", "2"]);
    await assertChainExact(w, x.id);
    await assertChainExact(w, f.id);
  });

  it("bán ghi TRƯỚC lớp thành phẩm cùng `at` → treo (giả định đã ghi nhận), lớp thành phẩm KHÔNG nuốt đơn treo", async () => {
    const { w, x, f } = await setup(true);
    // không có lớp THƯỜNG nào của F → giá tạm 0
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["0", "2"]);
    const out = (await layersOf(f.id))[0]!;
    expect([out.unitCost.toString(), out.qtyRemaining.toString()]).toEqual(["100", "4"]);
    await assertChainExact(w, x.id);
    await assertChainExact(w, f.id);
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

// ĐỔI KỲ VỌNG vòng sửa 4: tại cùng `at`, THỨ TỰ GHI quyết định lệnh nào dùng được thành phẩm của lệnh kia (vòng 3:
// mỗi bên treo 1, kết quả không phụ thuộc thứ tự ghi). Vẫn không chu trình: chỉ ăn lớp ghi TRƯỚC mình.
describe("vòng BOM cùng `at` (P→Q, Q→P) — không chu trình, thứ tự ghi quyết định", () => {
  const read = async (p: { id: number }, q: { id: number }) => {
    const use = async (n: number) => {
      const r = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "PRODUCTION_USE", docLineId: n } });
      return [r.unitCostOut.toString(), r.qtyProvisional.toString()];
    };
    const out = async (pid: number) => {
      const l = (await layersOf(pid)).find((x) => x.sourceDocType === "PRODUCTION_OUT")!;
      return [l.unitCost.toString(), l.qtyRemaining.toString()];
    };
    return { use1: await use(1), use2: await use(2), outP: await out(p.id), outQ: await out(q.id) };
  };
  const guard = () => {
    let calls = 0;
    registerCostOwner("PRODUCTION_USE", async () => {
      if (++calls > 30) throw new Error(`chủ dòng bị gọi ${calls} lần — không hội tụ nhanh`);
    });
  };

  it("ghi lệnh 1 trước: USE Q = 1@200 + 1 treo @200 = 200 → P = 200; USE P = 1@100 + 1@200 (thành phẩm P) = 150 → Q = 150", async () => {
    guard();
    const w = await newWorld(2);
    const { p, q } = await mutualBom(w, 1);
    expect(await read(p, q)).toEqual({ use1: ["200", "1"], use2: ["150", "0"], outP: ["200", "1"], outQ: ["150", "2"] });
    await assertChainExact(w, p.id);
    await assertChainExact(w, q.id);
  });

  it("ghi lệnh 2 trước: USE P = 1@100 + 1 treo @100 = 100 → Q = 100; USE Q = 1@200 + 1@100 (thành phẩm Q) = 150 → P = 150", async () => {
    guard();
    const w = await newWorld(2);
    const { p, q } = await mutualBom(w, 2);
    expect(await read(p, q)).toEqual({ use1: ["150", "0"], use2: ["100", "1"], outP: ["150", "2"], outQ: ["100", "1"] });
    await assertChainExact(w, p.id);
    await assertChainExact(w, q.id);
  });
});

describe("thứ tự ghi của lớp phụ thuộc so với dòng gốc", () => {
  it("dòng gốc ghi SAU lớp (cùng `at`) → DerivedLayerOrderError khi tính lại; không ghi gì", async () => {
    const w = await newWorld();
    await expect(engine(w)([w.p.id], async (ctx) => {
      await buy(ctx, w.p.id, 10, 100, T(0), 1);
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 0, docType: "RETURN_IN", docId: 9, docLineId: 9, at: T(5), costRef: { docType: "SALE", docLineId: 1, qty: 5 } });
      await sell(ctx, w.p.id, 5, T(5), 1);
    })).rejects.toThrow(DerivedLayerOrderError);
    expect(await prisma.stockLedger.count()).toBe(0);
  });

  it("khác mã: thành phẩm ghi TRƯỚC dòng dùng NVL (cùng `at`) → DerivedLayerOrderError khi lan truyền", async () => {
    const w = await newWorld(2);
    const [x, f] = w.products;
    await engine(w)([x!.id], (ctx) => buy(ctx, x!.id, 10, 100, T(0), 1));
    await expect(engine(w)([x!.id, f!.id], async (ctx) => {
      await postReceipt(ctx, { productId: f!.id, qty: 4, unitCost: 0, docType: "PRODUCTION_OUT", docId: 7, docLineId: 7, at: T(5), costRef: { docType: "PRODUCTION_USE", docLineId: 7, qty: 4 } });
      await postIssue(ctx, { productId: x!.id, qty: 4, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: T(5) });
    })).rejects.toThrow("Chứng từ gốc phải được ghi TRƯỚC chứng từ nhập theo giá của nó (trả hàng/thành phẩm).");
    expect(await prisma.costLayer.count({ where: { productId: f!.id } })).toBe(0);
  });

  it("costRef phải trỏ tới chứng từ XUẤT; trỏ chứng từ nhập → lỗi tiếng Việt", async () => {
    const w = await newWorld();
    await expect(engine(w)([w.p.id], async (ctx) => {
      await buy(ctx, w.p.id, 10, 100, T(0), 1);
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 0, docType: "RETURN_IN", docId: 9, docLineId: 9, at: T(5), costRef: { docType: "PURCHASE", docLineId: 1, qty: 10 } });
    })).rejects.toThrow(InvalidCostRefTypeError);
    await expect(engine(w)([w.p.id], (ctx) =>
      postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 0, docType: "RETURN_IN", docId: 9, docLineId: 9, at: T(5), costRef: { docType: "RETURN_IN", docLineId: 1, qty: 10 } }),
    )).rejects.toThrow("Chứng từ gốc để tính giá vốn phải là chứng từ XUẤT kho (bán, dùng NVL…).");
    expect(await prisma.stockLedger.count()).toBe(0);
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

  it("≈120 lớp phụ thuộc ở mã B; chủ dòng tổng hợp lặp trên mã A (0 lớp phụ thuộc) → bị chặn ở ngưỡng 50 trong vài giây", async () => {
    const w = await newWorld(2);
    const [a, b] = w.products;
    await seedDerived(w, b!.id, 120);
    expect(await prisma.costLayer.count({ where: { costRefType: { not: null } } })).toBe(120);
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

  it("≈120 lớp phụ thuộc ở CHÍNH mã đang lặp → ngân sách thời gian flush chặn với lỗi rõ ràng (không phải timeout transaction)", async () => {
    const w = await newWorld();
    await seedDerived(w, w.p.id, 120);
    const started = Date.now();
    const err = await engine(w)([w.p.id], async (ctx) => {
      registerCostOwner("SALE", async () => { markDirty(ctx, w.p.id, T(0)); });
      markDirty(ctx, w.p.id, T(0));
    }, { flushBudgetMs: 2_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineInvariantError);
    expect((err as Error).message).toMatch(/không hội tụ|quá thời gian/);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await prisma.costLayer.count({ where: { costRefType: { not: null } } })).toBe(120); // rollback, dữ liệu cũ còn nguyên
  }, 120_000);
});
