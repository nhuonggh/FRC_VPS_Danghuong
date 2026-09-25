import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";
import { lockPeriodForEngine } from "@/server/period/guard";
import { EngineBusyError, EngineInvariantError, ReplayTooLargeError } from "./errors";
import { assertDerivedAfterSource } from "./layers";
import { lockProducts } from "./lock";
import { lineSnapshots, resolveCostOwner, type LineKey } from "./owners";
import { registerAllCostOwners } from "./owners-register";
import { absorbRecomputeJob, deferRecompute, mergeRecomputeJob } from "./recompute-jobs";
import { replayProduct, unitCostOf, type TouchedLine } from "./replay";
import {
  DEFAULT_FLUSH_BUDGET_MS, DEFAULT_INLINE_LIMIT, FLUSH_BUDGET_MARGIN_MS, INLINE_TX_TIMEOUT_MS, WORKER_FLUSH_BUDGET_MS, WORKER_TX_TIMEOUT_MS,
  type EngineCtx, type Tx,
} from "./types";

export interface EngineOptions {
  /** Bỏ trống = kỳ đang mở. */
  periodId?: number;
  userId: number;
  /** ĐỦ mọi mã hàng sẽ chạm. Engine khoá theo thứ tự tăng dần. */
  products: number[];
  inlineLimit?: number;
  mode?: "inline" | "worker";
  /** Ngân sách thời gian flush (ms). Mặc định theo `mode` — xem engineTimeouts. */
  flushBudgetMs?: number;
  /** Timeout transaction (ms) của withInventoryTx. Mặc định theo `mode` — xem engineTimeouts. */
  txTimeoutMs?: number;
}

/** Mở ngữ cảnh kho trong 1 transaction: kiểm kỳ còn mở → khoá mã hàng (tăng dần). */
export async function beginEngine(tx: Tx, opts: EngineOptions): Promise<EngineCtx> {
  // Khoá kỳ (FOR SHARE) TRƯỚC mọi khoá advisory: tuần tự với kết sổ (FOR UPDATE) — review I2, docs/engine-fifo.md §6 K5
  const period = await lockPeriodForEngine(tx, opts.periodId);
  const ctx: EngineCtx = {
    tx, period, userId: opts.userId,
    locked: new Set(), dirty: new Map(), afterCommit: [],
    inlineLimit: opts.inlineLimit ?? DEFAULT_INLINE_LIMIT,
    mode: opts.mode ?? "inline",
    flushBudgetMs: engineTimeouts(opts).flushBudgetMs,
    removedSeqs: new Map(),
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

/**
 * Timeout transaction + ngân sách flush theo chế độ. Worker nền chạy transaction DÀI (chuỗi quá ngưỡng đồng bộ) nên
 * ngân sách flush được nâng CÙNG timeout — nếu không, worker báo "không hội tụ" oan ở 25 giây dù transaction còn 10
 * phút; ngược lại ngân sách ≥ timeout thì lỗi rõ ràng của flush bị thay bằng timeout transaction mơ hồ. Bất biến:
 * flushBudgetMs + FLUSH_BUDGET_MARGIN_MS ≤ txTimeoutMs (vi phạm = lỗi lập trình của người gọi).
 */
export function engineTimeouts(opts: Pick<EngineOptions, "mode" | "flushBudgetMs" | "txTimeoutMs">): { txTimeoutMs: number; flushBudgetMs: number } {
  const worker = opts.mode === "worker";
  const txTimeoutMs = opts.txTimeoutMs ?? (worker ? WORKER_TX_TIMEOUT_MS : INLINE_TX_TIMEOUT_MS);
  const flushBudgetMs = opts.flushBudgetMs ?? (worker ? WORKER_FLUSH_BUDGET_MS : DEFAULT_FLUSH_BUDGET_MS);
  if (!(flushBudgetMs > 0) || flushBudgetMs + FLUSH_BUDGET_MARGIN_MS > txTimeoutMs) {
    throw new EngineInvariantError(
      `Ngân sách flush ${flushBudgetMs} ms phải > 0 và nhỏ hơn timeout transaction ${txTimeoutMs} ms ít nhất ${FLUSH_BUDGET_MARGIN_MS} ms.`,
    );
  }
  return { txTimeoutMs, flushBudgetMs };
}

/**
 * Đồ thị phụ thuộc giá (dòng xuất → lớp phụ thuộc → dòng xuất ăn lớp đó) là DAG THEO THỜI GIAN nhờ hai quy tắc
 * (replay.ts): (1) lớp phụ thuộc KHÔNG nuốt đơn treo — đơn treo chỉ được nhập bù bằng lớp thường giá cố định;
 * (2) vị trí sự kiện của lớp phụ thuộc ở SAU dòng gốc: `at` không trước và GHI SAU dòng gốc (`assertDerivedAfterSource`);
 * tại cùng `at`: lớp thường trước, rồi lệnh xuất + lớp phụ thuộc theo thứ tự ghi. Lớp phụ thuộc cùng mã được định giá ngay trong
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
  // Mọi câu lệnh ở đây chạy THEO LÔ cho cả danh sách dòng (Task 9 — đo: 4 câu lệnh/dòng làm tính lại 2.000 dòng mất
  // ~16 s): số câu lệnh không phụ thuộc số dòng, trừ lời gọi chủ dòng (1 lần/dòng — hợp đồng CostOwner).
  const seen = new Set<string>();
  const keys: LineKey[] = [];
  for (const t of touched) {
    const key = `${t.docType}:${t.docLineId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push({ docType: t.docType, docLineId: t.docLineId });
  }
  if (keys.length === 0) return;
  const types = keys.map((k) => k.docType);
  const lines = keys.map((k) => k.docLineId);
  // KHOÁ TRƯỚC KHI ĐỌC (Task 7 fix round 1): tổng vốn dòng gốc cộng dòng sổ ở MỌI mã của dòng (NVL của lệnh SX / dòng
  // bán tôn xốp), và giá được ghi vào lớp phụ thuộc ở mã KHÁC (thành phẩm). Chỉ giữ khoá mã đang tính lại thì giao
  // dịch đồng thời đổi giá NVL khác thấy nửa cũ của nhau → bên commit sau ghi đè giá cũ (lost update) lên lớp thành
  // phẩm / chủ dòng. Khoá đủ các mã đó (của MỌI dòng) rồi mới đọc (READ COMMITTED: mỗi câu lệnh thấy dữ liệu đã commit
  // mới nhất). Khoá có thể lấy NGOÀI thứ tự tăng dần → Postgres có thể phát hiện deadlock → withInventoryTx chạy lại cả
  // giao dịch (retryOnDeadlock) trên dữ liệu đã commit: đúng, chỉ chậm hơn.
  const involved = await ctx.tx.$queryRaw<{ productId: number }[]>`
    SELECT s."productId" FROM stock_ledger s
      JOIN unnest(${types}::text[], ${lines}::int[]) AS k(t, l) ON s."docType" = k.t::stock_doc_type AND s."docLineId" = k.l
     WHERE s."qtyOut" > 0
    UNION
    SELECT c."productId" FROM cost_layers c
      JOIN unnest(${types}::text[], ${lines}::int[]) AS k(t, l) ON c."costRefType" = k.t::stock_doc_type AND c."costRefId" = k.l
     WHERE c."periodId" = ${ctx.period.id}`;
  await lockProducts(ctx, involved.map((r) => r.productId));

  const snaps = await lineSnapshots(ctx.tx, keys);
  for (const snap of snaps) {
    const owner = resolveCostOwner(snap.docType); // loại "required" chưa đăng ký ⇒ EngineInvariantError (fail closed)
    if (owner) await owner(ctx.tx, snap);
  }

  const derived = await ctx.tx.$queryRaw<{ id: number; productId: number; at: Date; seq: bigint; unitCost: Prisma.Decimal; costRefQty: Prisma.Decimal | null; t: string; l: number }[]>`
    SELECT c.id, c."productId", c.at, s.seq, c."unitCost", c."costRefQty", c."costRefType"::text AS t, c."costRefId" AS l
      FROM cost_layers c
      JOIN stock_ledger s ON s.id = c."ledgerId"
      JOIN unnest(${types}::text[], ${lines}::int[]) AS k(t, l) ON c."costRefType" = k.t::stock_doc_type AND c."costRefId" = k.l
     WHERE c."periodId" = ${ctx.period.id}
     ORDER BY c.at, s.seq, c.id`; // thứ tự tất định: lỗi vị trí (assertDerivedAfterSource) luôn báo cùng một lớp
  if (derived.length === 0) return;
  const srcKeys = [...new Map(derived.map((d) => [`${d.t}:${d.l}`, { t: d.t, l: d.l }])).values()];
  const srcRows = await ctx.tx.$queryRaw<{ seq: bigint; at: Date; t: string; l: number }[]>`
    SELECT s.seq, s.at, s."docType"::text AS t, s."docLineId" AS l
      FROM stock_ledger s
      JOIN unnest(${srcKeys.map((k) => k.t)}::text[], ${srcKeys.map((k) => k.l)}::int[]) AS k(t, l)
        ON s."docType" = k.t::stock_doc_type AND s."docLineId" = k.l
     WHERE s."qtyOut" > 0
     ORDER BY s.seq`;
  const srcOf = new Map<string, { seq: bigint; at: Date }[]>();
  for (const s of srcRows) {
    const k = `${s.t}:${s.l}`;
    srcOf.set(k, [...(srcOf.get(k) ?? []), { seq: BigInt(s.seq), at: s.at }]);
  }
  const snapOf = new Map(snaps.map((s) => [`${s.docType}:${s.docLineId}`, s]));
  const changed: { id: number; unitCost: Prisma.Decimal }[] = [];
  for (const layer of derived) {
    const k = `${layer.t}:${layer.l}`;
    // Dòng gốc có thể được đăng SAU lớp (cùng giao dịch) → kiểm quy tắc vị trí (at + seq) ở đây nữa (DAG)
    assertDerivedAfterSource({ at: layer.at, seq: BigInt(layer.seq) }, srcOf.get(k) ?? []);
    // postReceipt bảo đảm costRefQty > 0; gặp dữ liệu hỏng thì dừng hẳn thay vì lẳng lặng bỏ qua
    const refQty = layer.costRefQty === null ? null : new Prisma.Decimal(layer.costRefQty);
    if (!refQty || !refQty.gt(0)) {
      throw new EngineInvariantError(`Lớp ${layer.id}: costRefQty phải > 0 để lan truyền giá vốn.`);
    }
    const next = unitCostOf(snapOf.get(k)!.totalCost, refQty);
    if (!next.equals(new Prisma.Decimal(layer.unitCost))) {
      changed.push({ id: layer.id, unitCost: next });
      markDirty(ctx, layer.productId, layer.at);
    }
  }
  if (changed.length) {
    await ctx.tx.$executeRaw`
      UPDATE cost_layers cl SET "unitCost" = v.c
        FROM unnest(${changed.map((c) => c.id)}::int[], ${changed.map((c) => c.unitCost.toFixed(4))}::numeric[]) AS v(id, c)
       WHERE cl.id = v.id`;
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

    // Mã đang chờ tính lại nền (Task 8), đọc DƯỚI khoá mã: đồng bộ → chỉ gộp mốc vào job (worker sẽ tính); worker →
    // gộp mốc job vào lần tính này rồi xoá job + mở cờ (tính lại từng phần từ mốc muộn hơn thay đổi chưa tính là sai).
    let from = fromAt;
    const p = await ctx.tx.product.findUniqueOrThrow({ where: { id: productId }, select: { recomputing: true } });
    if (p.recomputing) {
      if (ctx.mode === "inline") { await mergeRecomputeJob(ctx, productId, fromAt); continue; }
      from = await absorbRecomputeJob(ctx, productId, fromAt);
    }
    let result;
    try {
      result = await replayProduct(ctx, productId, from);
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
 * Deadlock được tự thử lại tối đa 3 lần (chạy lại TOÀN BỘ `work` — `work` không được có tác dụng phụ ngoài `ctx.tx`);
 * hết lượt ⇒ EngineBusyError (DomainError 409 INVENTORY_BUSY, lỗi gốc ở `cause`).
 * Chuỗi quá ngưỡng đồng bộ (`inlineLimit`) KHÔNG làm giao dịch thất bại: mã đó được đánh dấu "đang tính lại" + job nền
 * (recompute.ts), giao dịch vẫn commit; lệnh xuất mã đó bị chặn tới khi worker tính xong.
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
  const { txTimeoutMs } = engineTimeouts(opts); // kiểm bất biến ngân sách < timeout TRƯỚC khi mở transaction
  registerAllCostOwners(); // điểm đăng ký chủ dòng trung tâm (owners-register.ts) — có mặt ở mọi bundle dùng engine
  let hooks: (() => void)[] = [];
  let result: R;
  try {
    result = await insideInventoryTx.run(true, () =>
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
          { maxWait: 10_000, timeout: txTimeoutMs },
        ),
      ),
    );
  } catch (e) {
    // Hết lượt chạy lại vì deadlock = tranh chấp tạm thời, không phải lỗi dữ liệu → lỗi nghiệp vụ "đang bận, thử lại"
    // (API trả 409 có thông điệp, worker nền để job PENDING) thay vì 500 với lỗi Postgres thô.
    if (isDeadlock(e)) throw new EngineBusyError(e);
    throw e;
  }
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
