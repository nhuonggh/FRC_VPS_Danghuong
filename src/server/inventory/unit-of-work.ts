import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@prisma/client";
import { assertPeriodOpen, getOpenPeriod } from "@/server/period/guard";
import { EngineInvariantError, ReplayTooLargeError } from "./errors";
import { assertDerivedAfterSource } from "./layers";
import { lockProducts } from "./lock";
import { getCostOwner, lineSnapshot } from "./owners";
import { replayProduct, unitCostOf, type TouchedLine } from "./replay";
import { DEFAULT_FLUSH_BUDGET_MS, DEFAULT_INLINE_LIMIT, type EngineCtx, type Tx } from "./types";

export interface EngineOptions {
  /** Bỏ trống = kỳ đang mở. */
  periodId?: number;
  userId: number;
  /** ĐỦ mọi mã hàng sẽ chạm. Engine khoá theo thứ tự tăng dần. */
  products: number[];
  inlineLimit?: number;
  mode?: "inline" | "worker";
  /** Ngân sách thời gian flush (ms), mặc định DEFAULT_FLUSH_BUDGET_MS. */
  flushBudgetMs?: number;
}

/** Mở ngữ cảnh kho trong 1 transaction: kiểm kỳ còn mở → khoá mã hàng (tăng dần). */
export async function beginEngine(tx: Tx, opts: EngineOptions): Promise<EngineCtx> {
  const period = opts.periodId ? await assertPeriodOpen(tx, opts.periodId) : await getOpenPeriod(tx);
  const ctx: EngineCtx = {
    tx, period, userId: opts.userId,
    locked: new Set(), dirty: new Map(), afterCommit: [],
    inlineLimit: opts.inlineLimit ?? DEFAULT_INLINE_LIMIT,
    mode: opts.mode ?? "inline",
    flushBudgetMs: opts.flushBudgetMs ?? DEFAULT_FLUSH_BUDGET_MS,
  };
  await lockProducts(ctx, opts.products);
  return ctx;
}

/** Ghi nhận mã hàng cần tính lại từ thời điểm `at` (giữ mốc SỚM NHẤT). */
export function markDirty(ctx: Pick<EngineCtx, "dirty">, productId: number, at: Date): void {
  const cur = ctx.dirty.get(productId);
  if (!cur || at < cur) ctx.dirty.set(productId, at);
}

const isDeadlock = (e: unknown): boolean => {
  const x = e as { code?: string; message?: string } | null;
  return x?.code === "P2034" || x?.code === "40P01" || /deadlock detected/i.test(x?.message ?? "");
};

/**
 * Chạy lại cả transaction khi PostgreSQL chọn nó làm nạn nhân deadlock (hiếm: chỉ khi lan truyền giá vốn
 * phải khoá THÊM mã hàng ngoài danh sách khai báo). Lỗi nghiệp vụ không bao giờ được thử lại.
 */
export async function retryOnDeadlock<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isDeadlock(e) || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 60));
    }
  }
}

// Thay ở Task 8 bằng import từ ./recompute
async function deferRecompute(_ctx: EngineCtx, productId: number, fromAt: Date): Promise<never> {
  throw new EngineInvariantError(`Mã hàng ${productId} (từ ${fromAt.toISOString()}): tính lại nền chưa được bật (Task 8).`);
}
async function mergeRecomputeJob(_ctx: EngineCtx, productId: number, fromAt: Date): Promise<never> {
  throw new EngineInvariantError(`Mã hàng ${productId} (từ ${fromAt.toISOString()}) đang tính lại nền (Task 8).`);
}

/**
 * Đồ thị phụ thuộc giá (dòng xuất → lớp phụ thuộc → dòng xuất ăn lớp đó) là DAG THEO THỜI GIAN nhờ hai quy tắc
 * (replay.ts): (1) lớp phụ thuộc KHÔNG nuốt đơn treo — đơn treo chỉ được nhập bù bằng lớp thường giá cố định;
 * (2) vị trí sự kiện của lớp phụ thuộc ở SAU dòng gốc: `at` không trước dòng gốc (`assertDerivedAfterSource`), và
 * tại cùng `at` thứ tự là lớp thường → lệnh xuất → lớp phụ thuộc. Lớp phụ thuộc cùng mã được định giá ngay trong
 * replay; chỉ lan truyền KHÁC mã (thành phẩm SX) mới cần thêm vòng — số lần tính lại một mã ≈ số lần lớp phụ thuộc
 * CỦA MÃ ĐÓ đổi giá. Lưới an toàn, hai tầng:
 *  - đếm: mỗi mã tối đa min(BASE + PER_DERIVED × (số lớp phụ thuộc CỦA MÃ ĐÓ trong kỳ), CAP) lần tính lại/giao dịch
 *    — co giãn để không chặn oan chuỗi sâu hợp lệ, nhưng có trần tuyệt đối;
 *  - thời gian: flush quá `ctx.flushBudgetMs` ⇒ lỗi rõ ràng (thay vì timeout transaction 30s mơ hồ khi mỗi lần tính
 *    lại đắt).
 * Chỉ vượt khi có lỗi lập trình (vd chủ dòng tự đánh dấu dirty) hoặc dữ liệu hỏng. flush xử lý mã nhỏ nhất trước
 * (không theo thứ tự tôpô): vài vòng thừa là chấp nhận được và vẫn nằm trong ngưỡng.
 */
const MAX_REPLAYS_BASE = 50;
const MAX_REPLAYS_PER_DERIVED = 2;
const MAX_REPLAYS_CAP = 500;

/** Đồng bộ giá vốn dòng về chủ sở hữu + cập nhật lớp PHỤ THUỘC; lớp đổi giá thì đánh dấu tính lại tiếp. */
async function propagate(ctx: EngineCtx, touched: TouchedLine[]): Promise<void> {
  const seen = new Set<string>();
  // PERF(Task 9): ~2 truy vấn/dòng (lineSnapshot + tìm lớp phụ thuộc) kể cả dòng không đổi — gộp theo lô nếu đo thấy chậm
  for (const t of touched) {
    const key = `${t.docType}:${t.docLineId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const snap = await lineSnapshot(ctx.tx, t.docType, t.docLineId);
    const owner = getCostOwner(t.docType);
    if (owner) await owner(ctx.tx, snap);
    const derived = await ctx.tx.costLayer.findMany({
      where: { costRefType: t.docType, costRefId: t.docLineId, periodId: ctx.period.id },
    });
    const srcRows = derived.length
      ? await ctx.tx.stockLedger.findMany({ where: { docType: t.docType, docLineId: t.docLineId, qtyOut: { gt: 0 } }, select: { productId: true, at: true } })
      : [];
    for (const layer of derived) {
      // Dòng gốc có thể được đăng SAU lớp (cùng giao dịch) → kiểm quy tắc thời gian ở đây nữa (DAG theo thời gian)
      assertDerivedAfterSource(layer, srcRows);
      // postReceipt bảo đảm costRefQty > 0; gặp dữ liệu hỏng thì dừng hẳn thay vì lẳng lặng bỏ qua
      if (!layer.costRefQty || !layer.costRefQty.gt(0)) {
        throw new EngineInvariantError(`Lớp ${layer.id}: costRefQty phải > 0 để lan truyền giá vốn.`);
      }
      const next = unitCostOf(snap.totalCost, layer.costRefQty);
      if (!next.equals(layer.unitCost)) {
        await ctx.tx.costLayer.update({ where: { id: layer.id }, data: { unitCost: next } });
        markDirty(ctx, layer.productId, layer.at);
      }
    }
  }
}

/**
 * Tính lại mọi mã hàng dirty (mã nhỏ nhất trước) cho tới khi hội tụ. Mã phát sinh thêm do lan truyền
 * (NVL → thành phẩm → dòng bán) được khoá bổ sung tại đây.
 */
export async function flush(ctx: EngineCtx): Promise<void> {
  const replays = new Map<number, number>();
  const limits = new Map<number, number>();
  const deadline = Date.now() + ctx.flushBudgetMs;
  while (ctx.dirty.size > 0) {
    const productId = Math.min(...ctx.dirty.keys());
    const fromAt = ctx.dirty.get(productId)!;
    ctx.dirty.delete(productId);
    if (Date.now() > deadline) {
      throw new EngineInvariantError(
        `Tính lại giá vốn không hội tụ: quá thời gian cho phép (${ctx.flushBudgetMs} ms) khi còn mã hàng ${productId} cần tính lại (lỗi lập trình hoặc dữ liệu phụ thuộc hỏng).`,
      );
    }
    const n = (replays.get(productId) ?? 0) + 1;
    replays.set(productId, n);
    if (n > MAX_REPLAYS_BASE) {
      let limit = limits.get(productId);
      if (limit === undefined) {
        const d = await ctx.tx.costLayer.count({ where: { periodId: ctx.period.id, productId, costRefType: { not: null } } });
        limit = Math.min(MAX_REPLAYS_BASE + MAX_REPLAYS_PER_DERIVED * d, MAX_REPLAYS_CAP);
        limits.set(productId, limit);
      }
      if (n > limit) {
        throw new EngineInvariantError(
          `Tính lại giá vốn không hội tụ: mã hàng ${productId} bị tính lại quá ${limit} lần trong một giao dịch (lỗi lập trình hoặc dữ liệu phụ thuộc hỏng).`,
        );
      }
    }
    await lockProducts(ctx, [productId]);

    if (ctx.mode === "inline") {
      const p = await ctx.tx.product.findUniqueOrThrow({ where: { id: productId }, select: { recomputing: true } });
      if (p.recomputing) { await mergeRecomputeJob(ctx, productId, fromAt); continue; }
    }
    let result;
    try {
      result = await replayProduct(ctx, productId, fromAt);
    } catch (e) {
      if (e instanceof ReplayTooLargeError && ctx.mode === "inline") { await deferRecompute(ctx, productId, fromAt); continue; }
      throw e;
    }
    await propagate(ctx, result.touched);
  }
}

/** Đánh dấu "đang ở trong withInventoryTx" theo chuỗi async (hook afterCommit chạy NGOÀI, được gọi lại). */
const insideInventoryTx = new AsyncLocalStorage<true>();

export interface WithInventoryOptions extends EngineOptions {
  /** Chạy SAU flush, TRONG cùng transaction (vd worker nền dọn cờ `recomputing`). */
  finalize?: (ctx: EngineCtx) => Promise<void>;
}

/**
 * Cách DUY NHẤT module nghiệp vụ được đụng vào kho: mở transaction → khoá mã hàng → `work` (ghi chứng từ + post/remove)
 * → flush (tính lại chuỗi, đồng bộ giá vốn về dòng chứng từ) → finalize → commit → hook afterCommit.
 * Deadlock được tự thử lại tối đa 3 lần (chạy lại TOÀN BỘ `work` — `work` không được có tác dụng phụ ngoài `ctx.tx`).
 */
export async function withInventoryTx<R>(
  prisma: PrismaClient,
  opts: WithInventoryOptions,
  work: (ctx: EngineCtx) => Promise<R>,
): Promise<R> {
  // Lồng withInventoryTx trong `work` mở transaction THỨ HAI: nó chờ khoá advisory mà transaction ngoài đang giữ
  // → treo tới hết timeout, và nếu chạy được thì hai phần commit tách rời (phá nguyên tắc 4). Chặn ngay.
  if (insideInventoryTx.getStore()) {
    throw new EngineInvariantError("Không lồng withInventoryTx: trong `work` hãy dùng chính `ctx` đang có.");
  }
  let hooks: (() => void)[] = [];
  const result = await insideInventoryTx.run(true, () =>
    retryOnDeadlock(() =>
      prisma.$transaction(
        async (tx) => {
          const ctx = await beginEngine(tx, opts);
          const r = await work(ctx);
          await flush(ctx);
          if (opts.finalize) await opts.finalize(ctx);
          hooks = ctx.afterCommit;
          return r;
        },
        { maxWait: 10_000, timeout: 30_000 },
      ),
    ),
  );
  // Dữ liệu ĐÃ commit: hook hỏng chỉ ghi log, không biến thao tác thành công thành lỗi cho người gọi
  for (const h of hooks) {
    try {
      h();
    } catch (e) {
      console.error("[inventory] afterCommit hook lỗi:", e);
    }
  }
  return result;
}
