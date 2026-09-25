import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCostOwners, registerCostOwner, type LineCostSnapshot } from "@/server/inventory/owners";
import { postReceipt, removeDocument, updateLayerCost } from "@/server/inventory/ports";
import { getOnHand } from "@/server/inventory/queries";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, consOf, engine, layersOf, newWorld, saleRow, sell, T } from "./helpers";
import { assertChainExact } from "./reference";

beforeEach(resetDb);
afterEach(clearCostOwners);

describe("bán âm kho / đơn treo / nhập bù (spec 3.3)", () => {
  it("bán khi chưa có lớp nào → treo toàn bộ, giá tạm 0; nhập bù → khớp đủ, gỡ treo", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    let s = await saleRow(1);
    expect([s.unitCostOut.toString(), s.qtyProvisional.toString()]).toEqual(["0", "30"]);
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("-30");
    await assertChainExact(w);

    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(20), 1));
    s = await saleRow(1);
    expect([s.unitCostOut.toString(), s.qtyProvisional.toString()]).toEqual(["20000", "0"]);
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("70");
    await assertChainExact(w);
  });

  it("thiếu một phần: phần có lớp theo FIFO + phần thiếu theo giá nhập gần nhất; nhập bù trả đúng giá lớp mới", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    let s = await saleRow(1);
    // 10@100 thật + 20 tạm @100 (giá nhập gần nhất)
    expect([s.unitCostOut.toString(), s.qtyProvisional.toString()]).toEqual(["100", "20"]);
    await assertChainExact(w);

    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 50, 130, T(20), 2));
    s = await saleRow(1);
    // (10×100 + 20×130)/30 = 3.600/30 = 120
    expect([s.unitCostOut.toString(), s.qtyProvisional.toString()]).toEqual(["120", "0"]);
    expect((await consOf(s.id)).map((c) => [c.qty.toString(), c.unitCost.toString()])).toEqual([["10", "100"], ["20", "130"]]);
    expect((await layersOf(w.p.id))[1]!.qtyRemaining.toString()).toBe("30");
    await assertChainExact(w);
  });

  it("nhiều đơn treo được nuốt theo thứ tự THỜI GIAN (cũ → mới), kể cả nuốt dở", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], async (ctx) => {
      await sell(ctx, w.p.id, 15, T(12), 2); // ghi trước nhưng muộn hơn
      await sell(ctx, w.p.id, 20, T(10), 1);
    });
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 25, 10, T(20), 1));
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["10", "0"]);
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["10", "10"]); // 5 thật + 10 tạm @10
    await assertChainExact(w);

    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 20, T(30), 2));
    // (5×10 + 10×20)/15 = 250/15 = 16,6666… → 16.6667
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["16.6667", "0"]);
    await assertChainExact(w);
  });

  it("nhập LÙI NGÀY trước đơn treo → đơn ăn lớp như bán thường (không chờ)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 8, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 5, 40, T(30), 2));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 5, 60, T(5), 1));
    // T5 lớp 5@60 → bán T10 ăn 5@60, treo 3 → lớp T30 nuốt 3@40 ⇒ (300 + 120)/8 = 52,5
    const s = await saleRow(1);
    expect([s.unitCostOut.toString(), s.qtyProvisional.toString()]).toEqual(["52.5", "0"]);
    await assertChainExact(w);
  });

  it("cùng thời điểm: lệnh xuất dùng được lớp cùng mốc dù dòng xuất được ghi trước (không treo)", async () => {
    const w = await newWorld();
    await engine(w)([w.p.id], async (ctx) => {
      await sell(ctx, w.p.id, 10, T(5), 1);
      await buy(ctx, w.p.id, 10, 50, T(5), 1);
    });
    const s = await saleRow(1);
    expect([s.unitCostOut.toString(), s.qtyProvisional.toString()]).toEqual(["50", "0"]);
    await assertChainExact(w);
  });
});

describe("sửa/hủy/khôi phục giữa chuỗi đi qua replay", () => {
  it("hủy phiếu nhập đã nuốt một đơn treo SỚM HƠN nó → đơn treo lại, tính lại bắt đầu từ đơn đó; khôi phục phiếu → khớp lại", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(5), 1)); // đơn treo
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 30, 100, T(10), 1)); // nuốt đơn T5
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, T(15), 2)); // hết hàng → treo, giá tạm = giá nhập gần nhất 100
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["100", "0"]);
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["100", "10"]);
    await assertChainExact(w);

    await run([w.p.id], async (ctx) => {
      await removeDocument(ctx, "PURCHASE", 1);
      // mốc tính lại phải là T5 (đơn đã ăn lớp bị xoá), KHÔNG phải T10 (thời điểm lớp)
      expect(ctx.dirty.get(w.p.id)).toEqual(T(5));
    });
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["0", "30"]);
    expect(await consOf((await saleRow(1)).id)).toEqual([]);
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["0", "10"]);
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("-40");
    await assertChainExact(w);

    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 25, 200, T(20), 2));
    // T5: 25@200 + 5 tạm (không có lớp ≤ T5 → lớp đầu tiên 200); T15: treo 10 @200
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["200", "5"]);
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["200", "10"]);
    await assertChainExact(w);

    // khôi phục phiếu nhập 1 tại `at` gốc T10 → T5 ăn 30@100; T15 treo rồi được lớp T20 nuốt 10@200
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 30, 100, T(10), 1));
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(1)).qtyProvisional.toString()]).toEqual(["100", "0"]);
    expect([(await saleRow(2)).unitCostOut.toString(), (await saleRow(2)).qtyProvisional.toString()]).toEqual(["200", "0"]);
    expect((await layersOf(w.p.id)).map((l) => l.qtyRemaining.toString())).toEqual(["0", "15"]);
    await assertChainExact(w);
  });

  it("hủy đơn bán giữa chuỗi → đơn sau được ăn lại lớp cũ", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 22000, T(20), 2));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 90, T(30), 2));
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1));
    // bán 90 giờ ăn trọn lớp 1 (100@20.000)
    expect((await saleRow(2)).unitCostOut.toString()).toBe("20000");
    expect((await layersOf(w.p.id)).map((l) => l.qtyRemaining.toString())).toEqual(["10", "100"]);
    await assertChainExact(w);
  });

  it("đổi giá lớp (cước nhập sau) → cập nhật cả đơn treo SỚM HƠN đã được lớp đó nuốt", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(5), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 50, 100, T(10), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, T(20), 2));
    await run([w.p.id], async (ctx) => {
      await updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 150 });
      expect(ctx.dirty.get(w.p.id)).toEqual(T(10)); // mốc = thời điểm lớp; đơn T5 được kéo vào qua consumption bị gỡ
    });
    expect((await saleRow(1)).unitCostOut.toString()).toBe("150");
    expect((await saleRow(2)).unitCostOut.toString()).toBe("150");
    expect((await consOf((await saleRow(1)).id)).map((c) => c.unitCost.toString())).toEqual(["150"]);
    await assertChainExact(w);
  });

  it("TEST CHUẨN CỦA KHÁCH + đổi giá lớp 1 → 21.000: bán 2 = (70×21.000 + 20×22.000)/90 = 21.222,2222", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 22000, T(20), 2));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 90, T(30), 2));
    await run([w.p.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 21000 }));
    expect((await saleRow(1)).unitCostOut.toString()).toBe("21000");
    expect((await saleRow(2)).unitCostOut.toString()).toBe("21222.2222");
    await assertChainExact(w);
  });
});

describe("tính lại từng phần == tính lại từ đầu == mô hình tham chiếu (chuỗi ngẫu nhiên có hạt giống)", () => {
  // LCG xác định — không dùng Math.random để lỗi tái hiện được
  const rng = (seed: number) => {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  };

  const MIN_RETURNS = 3;
  // tieProb = xác suất trả hàng CÙNG `at` dòng gốc (bán + trả lùi ngày cùng ngày); 1 = chế độ "cùng ngày" dồn trùng thời điểm
  for (const { seed, tieProb } of [
    { seed: 11, tieProb: 0.3 }, { seed: 2026, tieProb: 0.3 }, { seed: 90210, tieProb: 0.3 }, { seed: 424242, tieProb: 0.3 },
    { seed: 99, tieProb: 1 }, { seed: 31337, tieProb: 1 },
  ]) {
    it(`hạt giống ${seed} (tỉ lệ trả hàng trùng thời điểm ${tieProb}): 40 thao tác nhập/bán/TRẢ HÀNG (costRef)/hủy/khôi phục/đổi giá, lùi ngày, trùng thời điểm, số lẻ`, async () => {
      const w = await newWorld();
      const run = engine(w);
      const r = rng(seed);
      const pick = <X,>(xs: X[]): X => xs[Math.floor(r() * xs.length)]!;
      const qty = () => (r() < 0.5 ? String(1 + Math.floor(r() * 40)) : (1 + Math.floor(r() * 40) + Math.floor(r() * 1000) / 1000).toFixed(3));
      const cost = () => (r() < 0.5 ? String(100 + Math.floor(r() * 30000)) : (100 + r() * 30000).toFixed(4));
      type Doc = { kind: "PURCHASE" | "SALE" | "RETURN_IN"; n: number; qty: string; cost: string; at: Date; ref?: Doc };
      const live: Doc[] = [];
      const removed: Doc[] = [];
      let nBuy = 0;
      let nSell = 1000;
      let nRet = 5000;
      let nReturns = 0;
      let nTies = 0;
      const post = (ctx: Parameters<Parameters<ReturnType<typeof engine>>[1]>[0], d: Doc) =>
        d.kind === "PURCHASE" ? buy(ctx, w.p.id, d.qty, d.cost, d.at, d.n)
          : d.kind === "SALE" ? sell(ctx, w.p.id, d.qty, d.at, d.n)
            : postReceipt(ctx, {
                productId: w.p.id, qty: d.qty, unitCost: 0, docType: "RETURN_IN", docId: d.n, docLineId: d.n, at: d.at,
                costRef: { docType: "SALE", docLineId: d.ref!.n, qty: d.ref!.qty },
              });
      // Không hủy dòng bán còn lớp trả hàng dựa vào nó (engine chặn — DependentDocumentsError)
      const removable = () => live.filter((d) => !live.some((x) => x.ref === d));

      for (let step = 0; step < 40; step++) {
        const x = r();
        const at = T(5 * Math.floor(r() * 21)); // 21 mốc → trùng thời điểm thường xuyên
        if (x < 0.28 || live.length === 0) {
          const d: Doc = { kind: "PURCHASE", n: ++nBuy, qty: qty(), cost: cost(), at };
          await run([w.p.id], (ctx) => post(ctx, d));
          live.push(d);
        } else if (x < 0.58) {
          const d: Doc = { kind: "SALE", n: ++nSell, qty: qty(), cost: "0", at };
          await run([w.p.id], (ctx) => post(ctx, d));
          live.push(d);
        } else if (x < 0.72) {
          // Trả hàng theo đơn: SL ≤ SL bán; thời điểm KHÔNG TRƯỚC dòng bán gốc — tỉ lệ tieProb CÙNG `at` (bán + trả lùi ngày
          // cùng ngày → docTimestamp trùng), còn lại muộn hơn 1–4 mốc
          const sales = live.filter((d) => d.kind === "SALE");
          if (!sales.length) continue;
          const src = pick(sales);
          const tie = r() < tieProb;
          const at2 = tie ? src.at : T(5 * (Math.floor((src.at.getTime() - T(0).getTime()) / 300_000) + 1 + Math.floor(r() * 4)));
          const rq = new Prisma.Decimal(src.qty).times(r()).toDecimalPlaces(3, Prisma.Decimal.ROUND_DOWN);
          const d: Doc = { kind: "RETURN_IN", n: ++nRet, qty: (rq.gt(0) ? rq : new Prisma.Decimal(src.qty)).toString(), cost: "0", at: at2, ref: src };
          await run([w.p.id], (ctx) => post(ctx, d));
          live.push(d);
          nReturns++;
          if (tie) nTies++;
        } else if (x < 0.82) {
          const cands = removable();
          if (!cands.length) continue;
          const d = pick(cands);
          await run([w.p.id], (ctx) => removeDocument(ctx, d.kind, d.n));
          live.splice(live.indexOf(d), 1);
          removed.push(d);
        } else if (x < 0.9 && removed.length) {
          const d = removed.pop()!; // khôi phục tại `at` gốc
          if (d.ref && !live.includes(d.ref)) continue; // dòng gốc đã hủy → không khôi phục trả hàng
          await run([w.p.id], (ctx) => post(ctx, d));
          live.push(d);
        } else {
          const buys = live.filter((d) => d.kind === "PURCHASE");
          if (!buys.length) continue;
          const d = pick(buys);
          d.cost = cost();
          await run([w.p.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: d.n, unitCost: d.cost }));
        }
        await assertChainExact(w);
      }
      // bộ sinh phải thật sự tạo đủ lớp trả hàng (kể cả trùng `at` với dòng gốc) để quy tắc được kiểm
      expect(nReturns, `số thao tác TRẢ HÀNG (hạt giống ${seed})`).toBeGreaterThanOrEqual(MIN_RETURNS);
      if (tieProb === 1) expect(nTies, `số trả hàng CÙNG \`at\` dòng gốc (hạt giống ${seed})`).toBeGreaterThanOrEqual(MIN_RETURNS);
    }, 180_000);
  }
});

describe("flush: đồng bộ giá vốn về chủ sở hữu dòng + lan truyền lớp phụ thuộc", () => {
  it("chủ sở hữu dòng nhận snapshot (tổng vốn, phần treo) sau mỗi lần tính lại", async () => {
    const w = await newWorld();
    const seen: LineCostSnapshot[] = [];
    registerCostOwner("SALE", async (_tx, snap) => { seen.push(snap); });
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 7));
    const last = seen.filter((s) => s.docLineId === 7).at(-1)!;
    expect([last.docType, last.totalCost.toString(), last.qtyProvisional.toString()]).toEqual(["SALE", "3000", "20"]);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 20, 130, T(20), 2));
    const again = seen.filter((s) => s.docLineId === 7).at(-1)!;
    expect([again.totalCost.toString(), again.qtyProvisional.toString()]).toEqual(["3600", "0"]);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("lớp trả hàng (costRef) lấy giá vốn dòng bán gốc; đổi giá lô đầu → dòng bán, lớp trả và đơn bán sau đều hội tụ trong 1 lần flush", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 22000, T(20), 2));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 90, T(30), 2));
    await run([w.p.id], (ctx) =>
      postReceipt(ctx, { productId: w.p.id, qty: 10, unitCost: 0, docType: "RETURN_IN", docId: 50, docLineId: 50, at: T(40), costRef: { docType: "SALE", docLineId: 2, qty: 90 } }),
    );
    const ret = async () => (await prisma.costLayer.findFirstOrThrow({ where: { sourceDocType: "RETURN_IN" } })).unitCost.toString();
    // unitCost truyền vào (0) bị thay bằng giá dòng gốc: 90 × 20444,4444 / 90 — nếu không, giá lớp trả phụ thuộc
    // lịch sử tính lại (tính lại từ đầu sẽ đổi nó) → assertChainExact bên dưới bắt được
    expect(await ret()).toBe("20444.4444");
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 85, T(50), 3));
    // 80@22.000 + 5@20.444,4444 = 1.862.222,222 / 85 = 21.908,4967…
    expect((await saleRow(3)).unitCostOut.toString()).toBe("21908.4967");
    await assertChainExact(w);

    await run([w.p.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 21000 }));
    expect((await saleRow(2)).unitCostOut.toString()).toBe("21222.2222");
    expect(await ret()).toBe("21222.2222");
    // 80@22.000 + 5@21.222,2222 = 1.866.111,111 / 85 = 21.954,2483…6 → 21954.2484
    expect((await saleRow(3)).unitCostOut.toString()).toBe("21954.2484");
    await assertChainExact(w);
  });
});

describe("withInventoryTx", () => {
  it("finalize chạy SAU flush trong cùng transaction; afterCommit chạy sau commit; rollback thì không chạy afterCommit", async () => {
    const w = await newWorld();
    const run = engine(w);
    const order: string[] = [];
    const out = await run(
      [w.p.id],
      async (ctx) => {
        await buy(ctx, w.p.id, 10, 20000, T(0), 1);
        await sell(ctx, w.p.id, 3, T(1), 1);
        ctx.afterCommit.push(() => order.push("after"));
        return "kết quả";
      },
      {
        finalize: async (ctx) => {
          const s = await ctx.tx.stockLedger.findFirstOrThrow({ where: { docType: "SALE" } });
          order.push(`finalize:${s.unitCostOut.toString()}`);
        },
      },
    );
    expect(out).toBe("kết quả");
    expect(order).toEqual(["finalize:20000", "after"]);

    await expect(run([w.p.id], async (ctx) => {
      ctx.afterCommit.push(() => order.push("KHÔNG ĐƯỢC CHẠY"));
      await sell(ctx, w.p.id, 1, T(2), 2);
      throw new Error("hỏng");
    })).rejects.toThrow("hỏng");
    expect(order).toEqual(["finalize:20000", "after"]);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("hook afterCommit ném lỗi → KHÔNG biến giao dịch đã commit thành thất bại (ghi log)", async () => {
    const w = await newWorld();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await engine(w)([w.p.id], async (ctx) => {
        await buy(ctx, w.p.id, 1, 1, T(0), 1);
        ctx.afterCommit.push(() => { throw new Error("hook hỏng"); });
        return 42;
      });
      expect(r).toBe(42);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.costLayer.count()).toBe(1);
  });

  it("mode worker bỏ qua ngưỡng inline; inline vượt ngưỡng → không tính đồng bộ, rollback (Task 8 thay bằng hàng đợi nền)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await expect(run([w.p.id], async (ctx) => {
      await buy(ctx, w.p.id, 10, 5, T(0), 1);
      await sell(ctx, w.p.id, 4, T(1), 1);
    }, { inlineLimit: 1 })).rejects.toThrow();
    expect(await prisma.stockLedger.count()).toBe(0);

    await run([w.p.id], async (ctx) => {
      await buy(ctx, w.p.id, 10, 5, T(0), 1);
      await sell(ctx, w.p.id, 4, T(1), 1);
    }, { inlineLimit: 1, mode: "worker" });
    expect((await saleRow(1)).unitCostOut.toString()).toBe("5");
    await assertChainExact(w);
  });
});
