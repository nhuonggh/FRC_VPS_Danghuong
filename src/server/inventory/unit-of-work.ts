import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@prisma/client";
import { assertPeriodOpen, getOpenPeriod } from "@/server/period/guard";
import { EngineInvariantError, ReplayTooLargeError } from "./errors";
import { lockProducts } from "./lock";
import { getCostOwner, lineSnapshot } from "./owners";
import { replayProduct, unitCostOf, type TouchedLine } from "./replay";
import { DEFAULT_INLINE_LIMIT, type EngineCtx, type Tx } from "./types";

export interface EngineOptions {
  /** Bỏ trống = kỳ đang mở. */
  periodId?: number;
  userId: number;
  /** ĐỦ mọi mã hàng sẽ chạm. Engine khoá theo thứ tự tăng dần. */
  products: number[];
  inlineLimit?: number;
  mode?: "inline" | "worker";
}

/** Mở ngữ cảnh kho trong 1 transaction: kiểm kỳ còn mở → khoá mã hàng (tăng dần). */
export async function beginEngine(tx: Tx, opts: EngineOptions): Promise<EngineCtx> {
  const period = opts.periodId ? await assertPeriodOpen(tx, opts.periodId) : await getOpenPeriod(tx);
  const ctx: EngineCtx = {
    tx, period, userId: opts.userId,
    locked: new Set(), dirty: new Map(), afterCommit: [],
    inlineLimit: opts.inlineLimit ?? DEFAULT_INLINE_LIMIT,
    mode: opts.mode ?? "inline",
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
 * Đồ thị phụ thuộc giá (dòng xuất → lớp phụ thuộc → dòng xuất ăn lớp đó) là DAG NHỜ quy tắc trong replay.ts `take`:
 * lớp phụ thuộc không bao giờ cấp hàng cho chính dòng gốc của nó. Với DAG, mỗi mã hàng chỉ phải tính lại vài lần
 * trong 1 flush. Ngưỡng tính THEO MÃ HÀNG (không theo tổng số vòng) để giao dịch nhiều mã (kiểm kho 1.300 mã) không
 * bị chặn oan; vượt ngưỡng ⇒ dữ liệu tạo chu trình (vd hai đơn treo trả hàng chéo cho nhau) → dừng, rollback.
 */
const MAX_REPLAYS_PER_PRODUCT = 50;

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
    for (const layer of derived) {
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
  while (ctx.dirty.size > 0) {
    const productId = Math.min(...ctx.dirty.keys());
    const fromAt = ctx.dirty.get(productId)!;
    ctx.dirty.delete(productId);
    const n = (replays.get(productId) ?? 0) + 1;
    replays.set(productId, n);
    if (n > MAX_REPLAYS_PER_PRODUCT) {
      throw new EngineInvariantError(
        `Tính lại giá vốn không hội tụ: mã hàng ${productId} bị tính lại quá ${MAX_REPLAYS_PER_PRODUCT} lần trong một giao dịch (nghi ngờ giá vốn phụ thuộc vòng).`,
      );
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
