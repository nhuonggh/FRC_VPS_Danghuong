import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EngineBusyError, EngineInvariantError, PeriodClosedError, ProductRecomputingError } from "@/server/inventory/errors";
import { postIssue, postReceipt, removeDocument, updateLayerCost } from "@/server/inventory/ports";
import { resetStuckJobs, runRecomputeJobs } from "@/server/inventory/recompute";
import {
  DEFAULT_FLUSH_BUDGET_MS, FLUSH_BUDGET_MARGIN_MS, INLINE_TX_TIMEOUT_MS, WORKER_FLUSH_BUDGET_MS, WORKER_TX_TIMEOUT_MS,
} from "@/server/inventory/types";
import { engineTimeouts, withInventoryTx } from "@/server/inventory/unit-of-work";
import { prisma, resetDb } from "../helpers/db";
import { makePeriod, makeProduct } from "../helpers/factories";
import { assertLedgerBalanced, buy, engine, newWorld, saleRow, sell, T, type World } from "./helpers";
import { assertChainExact } from "./reference";

beforeEach(resetDb);

/** 6 đơn bán liên tiếp trên tồn lớn. Với inlineLimit = 3, sửa đơn ĐẦU sẽ chạm > 3 sự kiện. */
async function bigChain() {
  const w = await newWorld();
  const run = engine(w);
  await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1000, 100, T(0), 1));
  for (let i = 1; i <= 6; i++) await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, T(i * 10), i), { inlineLimit: 100 });
  await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1000, 200, T(80), 2));
  return { w, run };
}

const jobOf = (productId: number) => prisma.recomputeJob.findUniqueOrThrow({ where: { productId } });
const flagOf = async (productId: number) => (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).recomputing;

/** Client "bọc" chuyển tiếp mọi thứ sang `prisma`, riêng `$transaction` do test quyết định. */
function wrapTransaction(tx: (fn: unknown, opts: unknown) => Promise<unknown>): PrismaClient {
  return new Proxy(prisma, {
    get(target, key) {
      if (key === "$transaction") return tx;
      const v: unknown = Reflect.get(target, key);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });

describe("tính lại quá ngưỡng → chạy nền (spec 3.5)", () => {
  it("vượt ngưỡng: mã hàng bị đánh dấu 'đang tính lại', có job; chặn XUẤT mã đó; worker tính xong thì mở lại", async () => {
    const { w, run } = await bigChain();
    // Hủy đơn #1 (đầu chuỗi) → chạm 6 sự kiện > ngưỡng 3
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1), { inlineLimit: 3 });

    expect(await flagOf(w.p.id)).toBe(true);
    const job = await jobOf(w.p.id);
    expect(job.status).toBe("PENDING");
    expect(job.fromAt).toEqual(T(10));

    await expect(run([w.p.id], (ctx) => sell(ctx, w.p.id, 1, T(100), 99))).rejects.toThrow(ProductRecomputingError);

    expect(await runRecomputeJobs(prisma)).toBe(1);

    expect(await flagOf(w.p.id)).toBe(false);
    expect(await prisma.recomputeJob.count()).toBe(0);
    await assertChainExact(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 1, T(100), 99)); // mở lại được
    await assertChainExact(w);
  });

  it("thay đổi thứ hai trong lúc chờ → GỘP job (mốc sớm nhất), không tạo job thứ 2", async () => {
    const { w, run } = await bigChain();
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 3), { inlineLimit: 3 }); // T30
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 2), { inlineLimit: 3 }); // T20 sớm hơn
    expect(await prisma.recomputeJob.count()).toBe(1);
    expect((await jobOf(w.p.id)).fromAt).toEqual(T(20));
    expect(await runRecomputeJobs(prisma)).toBe(1);
    await assertChainExact(w);
  });

  it("đang chờ tính lại: NHẬP vẫn ghi được (chỉ gộp mốc vào job, không tính đồng bộ, dù dưới ngưỡng)", async () => {
    const { w, run } = await bigChain();
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 4), { inlineLimit: 2 }); // T40: #5, #6, lô T80 = 3 > 2
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 5, 50, T(15), 3)); // ngưỡng mặc định 2.000 — vẫn phải hoãn
    expect((await jobOf(w.p.id)).fromAt).toEqual(T(15));
    expect(await runRecomputeJobs(prisma)).toBe(1);
    await assertChainExact(w);
  });

  it("dưới ngưỡng → tính đồng bộ, KHÔNG tạo job", async () => {
    const { w, run } = await bigChain();
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 6), { inlineLimit: 100 });
    expect(await prisma.recomputeJob.count()).toBe(0);
    expect(await flagOf(w.p.id)).toBe(false);
  });

  it("kết quả tính nền GIỐNG HỆT tính đồng bộ", async () => {
    const a = await bigChain();
    await a.run([a.w.p.id], (ctx) => removeDocument(ctx, "SALE", 1), { inlineLimit: 3 });
    await runRecomputeJobs(prisma);
    const bg = (await prisma.stockLedger.findMany({ where: { docType: "SALE" }, orderBy: { docId: "asc" } })).map((r) => [r.docId, r.unitCostOut.toString(), r.qtyProvisional.toString()]);

    await resetDb();
    const b = await bigChain();
    await b.run([b.w.p.id], (ctx) => removeDocument(ctx, "SALE", 1), { inlineLimit: 100 });
    const sync = (await prisma.stockLedger.findMany({ where: { docType: "SALE" }, orderBy: { docId: "asc" } })).map((r) => [r.docId, r.unitCostOut.toString(), r.qtyProvisional.toString()]);
    expect(bg).toEqual(sync);
  });

  it("resetStuckJobs: job RUNNING bị kẹt (app sập giữa chừng) quay về PENDING", async () => {
    const { w } = await bigChain();
    await prisma.recomputeJob.create({ data: { periodId: w.periodId, productId: w.p.id, fromAt: T(10), status: "RUNNING" } });
    await resetStuckJobs(prisma);
    expect((await jobOf(w.p.id)).status).toBe("PENDING");
  });

  it("worker bật (RECOMPUTE_WORKER ≠ off): hoãn → sau commit tự đánh thức worker nền, tính xong không cần ai gọi", async () => {
    const { w, run } = await bigChain();
    const prev = process.env.RECOMPUTE_WORKER;
    process.env.RECOMPUTE_WORKER = "on";
    try {
      await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1), { inlineLimit: 3 });
      await vi.waitFor(async () => {
        expect(await prisma.recomputeJob.count()).toBe(0);
        expect(await flagOf(w.p.id)).toBe(false);
      }, { timeout: 15_000, interval: 50 });
    } finally {
      process.env.RECOMPUTE_WORKER = prev;
    }
    await assertChainExact(w);
  });

  it("đơn bán đang treo kết quả vẫn đọc được (giá cũ) trong lúc chờ worker, và saleRow không vỡ", async () => {
    const { w, run } = await bigChain();
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1), { inlineLimit: 3 });
    expect((await saleRow(2)).unitCostOut.toString()).toBe("100");
  });

  it("chuỗi DÀI: giao dịch đồng bộ commit ngay (không tính, không lỗi), worker tính hết trong transaction chế độ worker (timeout + ngân sách flush dài)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 100, T(0), 1));
    await run([w.p.id], async (ctx) => { for (let i = 1; i <= 40; i++) await sell(ctx, w.p.id, 3, T(i), i); });
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1000, 170, T(100), 2));
    // Đổi giá lô ĐẦU → 42 sự kiện > ngưỡng 10: không tính đồng bộ
    const inlineOpts: unknown[] = [];
    const inlineDb = wrapTransaction((fn, o) => { inlineOpts.push(o); return prisma.$transaction(fn as never, o as never); });
    await withInventoryTx(inlineDb, { periodId: w.periodId, userId: w.userId, products: [w.p.id], inlineLimit: 10 }, (ctx) =>
      updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 110 }));
    expect(inlineOpts).toEqual([{ maxWait: 10_000, timeout: INLINE_TX_TIMEOUT_MS }]);
    expect(await flagOf(w.p.id)).toBe(true);
    expect((await saleRow(1)).unitCostOut.toString()).toBe("100"); // chưa tính

    const workerOpts: unknown[] = [];
    const workerDb = wrapTransaction((fn, o) => { workerOpts.push(o); return prisma.$transaction(fn as never, o as never); });
    expect(await runRecomputeJobs(workerDb)).toBe(1);
    expect(workerOpts).toEqual([{ maxWait: 10_000, timeout: WORKER_TX_TIMEOUT_MS }]);
    expect((await saleRow(1)).unitCostOut.toString()).toBe("110");
    expect((await saleRow(40)).unitCostOut.toString()).toBe("170"); // 33 lô đầu hết ở đơn #34
    expect(await flagOf(w.p.id)).toBe(false);
    await assertChainExact(w);
  });

  it("job đã được worker NHẬN (mốc cũ) nhưng giao dịch đồng bộ gộp mốc SỚM hơn trước khi worker lấy được khoá → worker tính từ mốc mới", async () => {
    const w = await newWorld();
    const run = engine(w);
    // Lô 25 @100: #1 10, #2 10, #3 5 + 5 treo, #4..#6 treo → lô T80 @200 bù
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 25, 100, T(0), 1));
    for (let i = 1; i <= 6; i++) await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, T(i * 10), i));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1000, 200, T(80), 2));
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 4), { inlineLimit: 2 }); // T40: #5, #6, lô T80 = 3 > 2
    expect((await jobOf(w.p.id)).fromAt).toEqual(T(40));

    const g = gate();
    const txs: Promise<unknown>[] = [];
    try {
      // A giữ khoá mã sau khi hủy #2 (T20), CHƯA flush
      const a = run([w.p.id], async (ctx) => { await removeDocument(ctx, "SALE", 2); g.markHeld(); await g.opened; }, { inlineLimit: 2 });
      txs.push(a);
      await Promise.race([g.held, a]);
      const worker = runRecomputeJobs(prisma); // nhận job (mốc T40) rồi chờ khoá mã
      txs.push(worker);
      expect(await blockedOrDone(worker)).toBe("blocked");
      expect((await jobOf(w.p.id)).status).toBe("RUNNING");
      g.open(); // A flush: mã đang cờ → gộp mốc T20 vào job, commit
      await a;
      expect(await worker).toBe(1);
    } finally {
      await release(g, txs);
    }
    expect(await prisma.recomputeJob.count()).toBe(0);
    expect(await flagOf(w.p.id)).toBe(false);
    // #3 (T30, giữa T20 và T40) giờ ăn đủ 10 từ lô đầu; tính từ mốc cũ T40 sẽ để nguyên 150
    expect((await saleRow(3)).unitCostOut.toString()).toBe("100");
    await assertChainExact(w);
  });

  it("worker lan truyền sang mã KHÁC cũng đang chờ tính lại → gộp luôn job của mã đó (mốc sớm nhất), không tính từng phần sai", async () => {
    const w = await newWorld(2);
    const [m, f] = w.products as [World["p"], World["p"]];
    const run = engine(w);
    await run([m.id, f.id], async (ctx) => {
      await buy(ctx, m.id, 100, 30000, T(0), 1);
      await buy(ctx, f.id, 1, 50000, T(1), 2); // 1 thành phẩm tồn cũ
    });
    await run([f.id], (ctx) => sell(ctx, f.id, 1, T(5), 1)); // ăn hết tồn cũ
    await run([m.id, f.id], async (ctx) => {
      await postIssue(ctx, { productId: m.id, qty: 10, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: T(10) });
      await postReceipt(ctx, { productId: f.id, qty: 5, unitCost: 0, docType: "PRODUCTION_OUT", docId: 7, docLineId: 7, at: T(10), costRef: { docType: "PRODUCTION_USE", docLineId: 7, qty: 5 } });
    });
    for (let i = 2; i <= 5; i++) await run([f.id], (ctx) => sell(ctx, f.id, 1, T(i * 10), i));
    // Job mã NVL (id nhỏ hơn → worker nhận trước), rồi job thành phẩm: hủy phiếu nhập tồn cũ (T1) → #1 (T5) mất hàng
    await run([m.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 31000 }), { inlineLimit: 1 });
    await run([f.id], (ctx) => removeDocument(ctx, "PURCHASE", 2), { inlineLimit: 1 });
    expect((await jobOf(m.id)).fromAt).toEqual(T(0));
    expect((await jobOf(f.id)).fromAt).toEqual(T(1));

    // Job NVL → lan truyền giá thành phẩm (mốc T10) → thành phẩm đang cờ: gộp job T1 của nó vào lần tính này
    // (tính từ T10 thì #1 ở T5 mất consumption mà không vào hàng treo → sổ lệch)
    expect(await runRecomputeJobs(prisma)).toBe(1);
    expect(await prisma.recomputeJob.count()).toBe(0);
    expect([await flagOf(m.id), await flagOf(f.id)]).toEqual([false, false]);
    expect((await prisma.costLayer.findFirstOrThrow({ where: { productId: f.id, costRefType: { not: null } } })).unitCost.toString()).toBe("62000");
    expect((await saleRow(1)).qtyProvisional.toString()).toBe("1"); // lớp thành phẩm SX không lấp đơn treo (docs §2.2)
    expect((await saleRow(2)).unitCostOut.toString()).toBe("62000");
    for (const p of w.products) await assertChainExact(w, p.id);
  });

  it("job lỗi thật (kỳ đã kết sổ) → FAILED + ghi lỗi, GIỮ cờ chặn xuất; job khác vẫn chạy", async () => {
    const { w, run } = await bigChain();
    const closed = await makePeriod({ isOpen: null, status: "CLOSED" });
    const other = (await makeProduct()).id;
    await prisma.product.update({ where: { id: other }, data: { recomputing: true } });
    await prisma.recomputeJob.create({ data: { periodId: closed.id, productId: other, fromAt: T(0) } });
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1), { inlineLimit: 3 });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await runRecomputeJobs(prisma)).toBe(1);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    const failed = await jobOf(other);
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toBe(new PeriodClosedError().message);
    expect(await flagOf(other)).toBe(true);
    // Thay đổi mới trên mã có job FAILED: gộp mốc nhưng giữ FAILED (chờ người vận hành), worker không nhận lại
    await run([other], (ctx) => buy(ctx, other, 1, 1, T(5), 9));
    expect((await jobOf(other)).status).toBe("FAILED");
    expect(await runRecomputeJobs(prisma)).toBe(0);
    await assertChainExact(w);
  });
});

describe("kho bận: deadlock hết lượt chạy lại → EngineBusyError (Task 7 carry)", () => {
  it("withInventoryTx đổi deadlock hết lượt (3 lần) thành EngineBusyError (409 INVENTORY_BUSY, giữ lỗi gốc ở cause)", async () => {
    const w = await newWorld();
    let n = 0;
    const err = await engine(w)([w.p.id], async () => { n++; throw deadlock(); }).catch((e: unknown) => e);
    expect(n).toBe(3);
    expect(err).toBeInstanceOf(EngineBusyError);
    expect((err as EngineBusyError).status).toBe(409);
    expect((err as EngineBusyError).code).toBe("INVENTORY_BUSY");
    expect(((err as EngineBusyError).cause as { code?: string }).code).toBe("40P01");
  });

  it("deadlock lần đầu rồi thành công → KHÔNG báo bận; lỗi khác KHÔNG bị đổi thành bận", async () => {
    const w = await newWorld();
    let n = 0;
    await engine(w)([w.p.id], async (ctx) => { if (++n === 1) throw deadlock(); await buy(ctx, w.p.id, 1, 1, T(0), 1); });
    expect(n).toBe(2);
    await expect(engine(w)([w.p.id], (ctx) => sell(ctx, w.p.id, 0, T(1), 1))).rejects.not.toBeInstanceOf(EngineBusyError);
  });

  it("worker gặp kho bận: job về PENDING (không FAILED), cờ vẫn chặn xuất, không quay vòng nóng; lượt sau tính xong", async () => {
    const { w, run } = await bigChain();
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1), { inlineLimit: 3 });
    let calls = 0;
    const busyDb = wrapTransaction(async () => { calls++; throw deadlock(); });
    expect(await runRecomputeJobs(busyDb)).toBe(0);
    expect(calls).toBe(3); // đúng 1 job × 3 lần thử, không nhận lại ngay trong cùng lượt
    const job = await jobOf(w.p.id);
    expect(job.status).toBe("PENDING");
    expect(job.attempts).toBe(1);
    expect(await flagOf(w.p.id)).toBe(true);

    expect(await runRecomputeJobs(prisma)).toBe(1);
    await assertChainExact(w);
  });
});

describe("timeout transaction & ngân sách flush theo chế độ", () => {
  it("mặc định: đồng bộ 30s/25s; worker nâng CẢ HAI; ngân sách phải nhỏ hơn timeout ít nhất một lề", () => {
    expect(engineTimeouts({})).toEqual({ txTimeoutMs: INLINE_TX_TIMEOUT_MS, flushBudgetMs: DEFAULT_FLUSH_BUDGET_MS });
    expect(engineTimeouts({ mode: "worker" })).toEqual({ txTimeoutMs: WORKER_TX_TIMEOUT_MS, flushBudgetMs: WORKER_FLUSH_BUDGET_MS });
    for (const m of ["inline", "worker"] as const) {
      const t = engineTimeouts({ mode: m });
      expect(t.flushBudgetMs + FLUSH_BUDGET_MARGIN_MS).toBeLessThanOrEqual(t.txTimeoutMs);
    }
    expect(WORKER_FLUSH_BUDGET_MS).toBeGreaterThan(INLINE_TX_TIMEOUT_MS); // worker không bị chặn bởi ngân sách đồng bộ
    expect(() => engineTimeouts({ flushBudgetMs: WORKER_FLUSH_BUDGET_MS })).toThrow(EngineInvariantError); // ngân sách worker + timeout đồng bộ
    expect(() => engineTimeouts({ mode: "worker", txTimeoutMs: 20_000 })).toThrow(EngineInvariantError);
    expect(() => engineTimeouts({ flushBudgetMs: 0 })).toThrow(EngineInvariantError);
    expect(engineTimeouts({ flushBudgetMs: 2_000 })).toEqual({ txTimeoutMs: INLINE_TX_TIMEOUT_MS, flushBudgetMs: 2_000 });
  });

  it("cấu hình sai bị chặn TRƯỚC khi mở transaction (không ghi gì)", async () => {
    const w = await newWorld();
    await expect(engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 1, 1, T(0), 1), { flushBudgetMs: 60_000 })).rejects.toThrow(EngineInvariantError);
    expect(await prisma.stockLedger.count()).toBe(0);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });
});

/* ── điều phối tất định cho test đồng thời (cùng cách derived-concurrency.test.ts) ── */
function gate() {
  let open!: () => void;
  let markHeld!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  const held = new Promise<void>((r) => (markHeld = r));
  return { opened, held, open, markHeld };
}

async function release(g: ReturnType<typeof gate>, txs: Promise<unknown>[]): Promise<void> {
  g.open();
  await Promise.allSettled(txs);
}

async function blockedOrDone(p: Promise<unknown>, timeoutMs = 10_000): Promise<"blocked" | "done"> {
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (settled) return "done";
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`;
    if (rows[0]!.n > 0) return "blocked";
    if (Date.now() > deadline) throw new Error("worker không xong cũng không bị chặn");
    await new Promise((r) => setTimeout(r, 20));
  }
}
