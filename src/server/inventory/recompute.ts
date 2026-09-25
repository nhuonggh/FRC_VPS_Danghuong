import type { PrismaClient } from "@prisma/client";
import { EngineBusyError } from "./errors";
import { WORKER_TX_TIMEOUT_MS } from "./types";
import { markDirty, withInventoryTx } from "./unit-of-work";

export { absorbRecomputeJob, deferRecompute, mergeRecomputeJob } from "./recompute-jobs";

/*
 * Tính lại giá vốn CHẠY NỀN (spec 3.5, Task 8). Giao dịch đồng bộ gặp chuỗi quá `inlineLimit` sự kiện thì không tính
 * mà đánh dấu mã hàng `recomputing` + ghi job (recompute-jobs.ts) rồi commit; lệnh xuất mã đó bị chặn
 * (ProductRecomputingError) tới khi worker ở đây tính xong. Worker = vòng lặp trong CÙNG tiến trình Next (instrumentation.ts
 * gọi bootRecomputeWorker khi khởi động; afterCommit gọi sau mỗi lần hoãn), mỗi job 1 transaction chế độ "worker"
 * (không ngưỡng, timeout / ngân sách flush dài — engineTimeouts). Nhận job bằng FOR UPDATE SKIP LOCKED, tính lại dưới
 * khoá advisory mã hàng. GIẢ ĐỊNH MỘT tiến trình app (xem docs/engine-fifo.md §6).
 *
 * Lỗi (fix round 1): lỗi TẠM THỜI (kho bận / deadlock, timeout transaction, hết kết nối pool, mất kết nối DB) → job về
 * PENDING, thử lại sau với giãn cách tăng dần; quá MAX_JOB_ATTEMPTS lần mới FAILED. Lỗi thật (dữ liệu/lập trình) →
 * FAILED ngay. FAILED giữ cờ chặn xuất tới khi người vận hành gọi retryFailedJob. Lỗi ở chính bước nhận job / ghi
 * trạng thái (DB chập chờn) → ghi log + hẹn chạy lại, không bao giờ để promise bị từ chối âm thầm.
 */

/** Người dùng "hệ thống" khi worker nền chạy (createdBy không có FK). */
export const SYSTEM_USER_ID = 0;

/** Số lần nhận job tối đa (đếm `attempts`, tăng mỗi lần nhận) trước khi lỗi tạm thời bị coi là FAILED. */
export const MAX_JOB_ATTEMPTS = 5;
/** Giãn cách thử lại: RETRY_BASE_MS × 2^(attempts−1), trần RETRY_MAX_MS. */
export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_MS = 60_000;
/** Chu kỳ quét job kẹt / job PENDING bị lỡ. */
export const SWEEP_INTERVAL_MS = 60_000;
/**
 * Job RUNNING lâu hơn mức này chắc chắn không còn transaction nào chạy: retryOnDeadlock chạy tối đa 3 transaction
 * nối tiếp, mỗi cái ≤ maxWait 10 s + timeout worker; cộng lề 60 s.
 */
export const STALE_RUNNING_MS = 3 * (WORKER_TX_TIMEOUT_MS + 10_000) + 60_000;
/** Khởi động: DB chưa sẵn sàng thì thử lại sau chừng này. */
export const BOOT_RETRY_MS = 30_000;

const workerEnabled = () => process.env.RECOMPUTE_WORKER !== "off";

/**
 * Trạng thái worker trong tiến trình — SINGLETON trên `globalThis` (như src/lib/prisma.ts): Next dev (HMR) / bundle có
 * thể nạp module này nhiều lần trong CÙNG tiến trình; biến cấp module sẽ nhân đôi worker + timer quét (chạy chồng).
 */
interface WorkerState {
  current: Promise<void> | null;
  again: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  sweepTimer: ReturnType<typeof setInterval> | null;
  bootTimers: Set<ReturnType<typeof setTimeout>>;
  /** Số lần NHẬN job lỗi liên tiếp (DB chập chờn) → giãn cách thử lại tăng dần. */
  claimFailures: number;
}
const globalForWorker = globalThis as unknown as { __dhRecomputeWorker?: WorkerState };
const worker: WorkerState = (globalForWorker.__dhRecomputeWorker ??= {
  current: null, again: false, retryTimer: null, sweepTimer: null, bootTimers: new Set(), claimFailures: 0,
});
const defaultDb = async (): Promise<PrismaClient> => (await import("@/lib/prisma")).prisma;
const backoffMs = (attempts: number) => Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);

const TRANSIENT_CODES = new Set([
  "P2034", // write conflict / deadlock (Prisma)
  "40P01", // deadlock_detected
  "40001", // serialization_failure
  "P2028", // Transaction API error (hết giờ transaction / transaction đã đóng)
  "P2024", // hết giờ chờ kết nối từ pool
  "P1001", // không kết nối được DB
  "P1002", // DB timeout khi kết nối
  "P1008", // operation timeout
  "P1017", // server đóng kết nối
  "P2037", // quá nhiều kết nối tới DB (Prisma)
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now (DB đang khởi động / phục hồi)
  "53300", // too_many_connections
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
]);
const TRANSIENT_MESSAGE =
  /deadlock detected|connection (?:reset|terminated|closed|refused)|terminating connection|server has closed the connection|can't reach database server|timed out fetching a new connection|transaction already closed|transaction not found|too many (?:database )?connections|the database system is (?:starting up|in recovery mode)|ECONNRESET|ECONNREFUSED/i;

/** Lỗi tạm thời (thử lại có thể thành công) — không phải lỗi dữ liệu/lập trình. */
export function isTransientError(e: unknown): boolean {
  if (e instanceof EngineBusyError) return true;
  const x = e as { code?: unknown; message?: unknown; errorCode?: unknown; meta?: { code?: unknown } } | null;
  const code = typeof x?.code === "string" ? x.code : typeof x?.errorCode === "string" ? x.errorCode : undefined;
  if (code && TRANSIENT_CODES.has(code)) return true;
  // P2010 = truy vấn thô ($queryRaw/$executeRaw) lỗi: mã Postgres thật nằm ở meta.code (vd 40P01, 57P03, 53300)
  if (code === "P2010" && typeof x?.meta?.code === "string" && TRANSIENT_CODES.has(x.meta.code)) return true;
  return typeof x?.message === "string" && TRANSIENT_MESSAGE.test(x.message);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Sau khi app khởi động lại: job đang RUNNING mà không còn tiến trình nào chạy → quay về PENDING. */
export async function resetStuckJobs(db: PrismaClient): Promise<void> {
  await db.recomputeJob.updateMany({ where: { status: "RUNNING" }, data: { status: "PENDING" } });
}

/** Job RUNNING quá STALE_RUNNING_MS (tiến trình chết giữa chừng mà không khởi động lại) → PENDING. Trả số job. */
export async function resetStaleRunningJobs(db: PrismaClient, now: Date = new Date()): Promise<number> {
  const r = await db.recomputeJob.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } },
    data: { status: "PENDING" },
  });
  return r.count;
}

export interface RecomputePassResult {
  /** Số job đã tính xong. */
  done: number;
  /** Có việc cần thử lại (lỗi tạm thời / nhận job lỗi) ⇒ hẹn chạy lại sau chừng này ms; null = không cần. */
  retryInMs: number | null;
}

/**
 * Một lượt: xử lý hết job PENDING (mỗi job = 1 transaction giữ khoá mã hàng, không giới hạn ngưỡng). KHÔNG bao giờ
 * reject: lỗi hạ tầng ở bước nhận job / ghi trạng thái được ghi log và báo qua `retryInMs`.
 */
export async function runRecomputePass(db: PrismaClient): Promise<RecomputePassResult> {
  const res: RecomputePassResult = { done: 0, retryInMs: null };
  const retryIn = (ms: number) => { res.retryInMs = res.retryInMs === null ? ms : Math.min(res.retryInMs, ms); };
  const skipped: number[] = []; // job để lại PENDING trong lượt này — không nhận lại ngay (tránh quay vòng nóng)
  for (;;) {
    let job: { id: number; periodId: number; productId: number; fromAt: Date; attempts: number } | undefined;
    try {
      const claimed = await db.$queryRaw<{ id: number; periodId: number; productId: number; fromAt: Date; attempts: number }[]>`
        UPDATE recompute_jobs
           SET status = 'RUNNING', attempts = attempts + 1, "updatedAt" = now()
         WHERE id = (SELECT id FROM recompute_jobs
                      WHERE status = 'PENDING' AND NOT (id = ANY(${skipped}::int[]))
                      ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, "periodId", "productId", "fromAt", attempts`;
      job = claimed[0];
      worker.claimFailures = 0;
    } catch (e) {
      // DB chập chờn/sập: giãn cách TĂNG DẦN theo số lần nhận lỗi liên tiếp (không dội DB mỗi 2 s), ghi log chỉ khi
      // giãn cách vừa tăng một bậc; đã tới trần thì 10 lần lỗi mới ghi 1 lần (≈ 10 phút) — không tràn log khi DB sập lâu
      const n = ++worker.claimFailures;
      const ms = backoffMs(n);
      if (ms > backoffMs(n - 1) || n === 1 || n % 10 === 0) {
        console.error(`[recompute] không nhận được job (DB?) — lần lỗi liên tiếp thứ ${n}, thử lại sau ${ms} ms:`, e);
      }
      retryIn(ms);
      return res;
    }
    if (!job) return res;
    const j = job;
    try {
      await withInventoryTx(
        db,
        {
          periodId: j.periodId, userId: SYSTEM_USER_ID, products: [j.productId], mode: "worker",
          // flush đã gộp + xoá job và mở cờ (absorbRecomputeJob) khi mã còn cờ; dọn lại cho chắc trường hợp job tồn tại
          // mà cờ đã tắt (dữ liệu bất thường) — idempotent
          finalize: async (ctx) => {
            await ctx.tx.recomputeJob.deleteMany({ where: { id: j.id } });
            await ctx.tx.product.update({ where: { id: j.productId }, data: { recomputing: false } });
          },
        },
        // Mốc thật đọc lại DƯỚI khoá mã trong flush (absorbRecomputeJob) — `j.fromAt` lúc nhận có thể đã cũ
        async (ctx) => markDirty(ctx, j.productId, j.fromAt),
      );
      res.done++;
      continue;
    } catch (e) {
      const transient = isTransientError(e);
      try {
        if (transient && j.attempts < MAX_JOB_ATTEMPTS) {
          console.warn(`[recompute] job ${j.id} (mã ${j.productId}) lỗi tạm thời, lần ${j.attempts}/${MAX_JOB_ATTEMPTS} — thử lại sau:`, errText(e));
          await db.recomputeJob.updateMany({ where: { id: j.id, status: "RUNNING" }, data: { status: "PENDING", error: errText(e) } });
          skipped.push(j.id);
          retryIn(backoffMs(j.attempts));
        } else {
          // Lỗi thật, hoặc lỗi tạm thời lặp quá MAX_JOB_ATTEMPTS: FAILED + GIỮ cờ recomputing (chặn xuất) chờ người vận
          // hành (retryFailedJob) — không nuốt lỗi, không thử lại mãi
          console.error(`[recompute] job ${j.id} (mã ${j.productId}) FAILED sau ${j.attempts} lần:`, e);
          await db.recomputeJob.updateMany({ where: { id: j.id }, data: { status: "FAILED", error: errText(e) } });
        }
      } catch (e2) {
        // Không ghi được trạng thái (DB chập chờn): job kẹt RUNNING — quét định kỳ trả về PENDING; hẹn chạy lại
        console.error(`[recompute] không ghi được trạng thái job ${j.id}:`, e2);
        retryIn(backoffMs(j.attempts));
        return res;
      }
    }
  }
}

/**
 * Xử lý hết job PENDING, trả số job đã tính xong (xem runRecomputePass). Job lỗi thật → FAILED + giữ cờ recomputing
 * (chặn xuất); lỗi tạm thời → về PENDING, bỏ qua trong lượt này (worker hẹn giờ chạy lại).
 */
export async function runRecomputeJobs(db: PrismaClient): Promise<number> {
  return (await runRecomputePass(db)).done;
}

/**
 * Công cụ khôi phục cho người vận hành (plan 03 ops): job FAILED của mã → PENDING, attempts = 0, xoá lỗi, đánh thức
 * worker. Trả false nếu mã không có job FAILED.
 */
export async function retryFailedJob(productId: number, db?: PrismaClient): Promise<boolean> {
  const client = db ?? (await defaultDb());
  const r = await client.recomputeJob.updateMany({
    where: { productId, status: "FAILED" },
    data: { status: "PENDING", attempts: 0, error: null },
  });
  if (r.count > 0) kickRecomputeWorker(db);
  return r.count > 0;
}

/* ───────────────────────── vòng đời worker trong tiến trình ───────────────────────── */

function scheduleKick(db: PrismaClient | undefined, ms: number): void {
  if (worker.retryTimer) clearTimeout(worker.retryTimer);
  worker.retryTimer = setTimeout(() => {
    worker.retryTimer = null;
    kickRecomputeWorker(db);
  }, ms);
  worker.retryTimer.unref?.();
}

/**
 * Đánh thức worker (không chạy chồng trong 1 tiến trình). Gọi sau commit và khi app khởi động. Được đánh thức khi đang
 * chạy ⇒ chạy thêm 1 lượt sau lượt hiện tại (job ghi sau lần nhận cuối không bị bỏ sót). Lượt cần thử lại ⇒ hẹn giờ.
 */
export function kickRecomputeWorker(db?: PrismaClient): void {
  if (!workerEnabled()) return; // test: tự gọi runRecomputeJobs để kiểm soát thời điểm
  if (worker.current) { worker.again = true; return; }
  worker.again = false;
  worker.current = new Promise<void>((r) => setImmediate(r)).then(async () => {
    let retryInMs: number | null = null;
    try {
      retryInMs = (await runRecomputePass(db ?? (await defaultDb()))).retryInMs;
    } catch (e) {
      console.error("[recompute]", e); // runRecomputePass không reject; phòng hờ (vd nạp @/lib/prisma lỗi)
      retryInMs = RETRY_BASE_MS;
    } finally {
      worker.current = null;
    }
    if (worker.again) kickRecomputeWorker(db);
    else if (retryInMs !== null) scheduleKick(db, retryInMs);
  });
}

/** Chờ worker trong tiến trình rảnh (kể cả lượt chạy thêm) — cho test / tắt app êm. */
export async function recomputeWorkerIdle(): Promise<void> {
  while (worker.current) await worker.current;
}

/** Một nhịp quét: job RUNNING kẹt → PENDING, rồi đánh thức worker (nhặt cả job PENDING bị lỡ). Không reject. */
export async function sweepRecomputeJobs(db?: PrismaClient): Promise<void> {
  try {
    const n = await resetStaleRunningJobs(db ?? (await defaultDb()));
    if (n > 0) console.warn(`[recompute] trả ${n} job RUNNING kẹt về PENDING`);
  } catch (e) {
    console.error("[recompute] quét job lỗi:", e);
  }
  kickRecomputeWorker(db);
}

/** Bật quét định kỳ (unref — không giữ tiến trình sống). Chỉ khi worker bật; gọi lại nhiều lần không tạo thêm timer. */
export function startRecomputeSweep(db?: PrismaClient, intervalMs = SWEEP_INTERVAL_MS): void {
  if (!workerEnabled() || worker.sweepTimer) return;
  worker.sweepTimer = setInterval(() => { void sweepRecomputeJobs(db); }, intervalMs);
  worker.sweepTimer.unref?.();
}

/**
 * Huỷ mọi timer của worker (test / tắt app) và xoá bộ đếm lỗi nhận job. Lượt đang chạy vẫn chạy nốt — chờ bằng
 * recomputeWorkerIdle.
 */
export function stopRecomputeTimers(): void {
  if (worker.retryTimer) clearTimeout(worker.retryTimer);
  if (worker.sweepTimer) clearInterval(worker.sweepTimer);
  for (const t of worker.bootTimers) clearTimeout(t);
  worker.bootTimers.clear();
  worker.retryTimer = null;
  worker.sweepTimer = null;
  worker.claimFailures = 0;
}

/**
 * Khởi động (instrumentation.ts): KHÔNG BAO GIỜ reject — DB chưa sẵn sàng thì ghi log và thử lại sau BOOT_RETRY_MS,
 * để Next khởi động bình thường. Thành công: trả job RUNNING kẹt về PENDING, rồi (nếu worker bật) đánh thức + bật quét.
 */
export async function bootRecomputeWorker(db?: PrismaClient, retryMs = BOOT_RETRY_MS): Promise<void> {
  try {
    await resetStuckJobs(db ?? (await defaultDb()));
  } catch (e) {
    console.error(`[recompute] khởi động: chưa dọn được job kẹt (DB chưa sẵn sàng?) — thử lại sau ${retryMs} ms:`, e);
    const t = setTimeout(() => {
      worker.bootTimers.delete(t);
      void bootRecomputeWorker(db, retryMs);
    }, retryMs);
    t.unref?.();
    worker.bootTimers.add(t);
    return;
  }
  kickRecomputeWorker(db);
  startRecomputeSweep(db);
}
