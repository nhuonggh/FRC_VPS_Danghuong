import type { PrismaClient } from "@prisma/client";
import { EngineBusyError } from "./errors";
import { markDirty, withInventoryTx } from "./unit-of-work";

export { absorbRecomputeJob, deferRecompute, mergeRecomputeJob } from "./recompute-jobs";

/*
 * Tính lại giá vốn CHẠY NỀN (spec 3.5, Task 8). Giao dịch đồng bộ gặp chuỗi quá `inlineLimit` sự kiện thì không tính
 * mà đánh dấu mã hàng `recomputing` + ghi job (recompute-jobs.ts) rồi commit; lệnh xuất mã đó bị chặn
 * (ProductRecomputingError) tới khi worker ở đây tính xong. Worker = vòng lặp trong CÙNG tiến trình Next (instrumentation.ts
 * gọi khi khởi động; afterCommit gọi sau mỗi lần hoãn), mỗi job 1 transaction chế độ "worker" (không ngưỡng, timeout /
 * ngân sách flush dài — engineTimeouts). Nhiều tiến trình cùng chạy vẫn an toàn: nhận job bằng FOR UPDATE SKIP LOCKED,
 * tính lại dưới khoá advisory mã hàng.
 */

/** Người dùng "hệ thống" khi worker nền chạy (createdBy không có FK). */
export const SYSTEM_USER_ID = 0;

/** Chờ trước khi thử lại job bị hoãn vì kho bận (deadlock hết lượt). */
const BUSY_RETRY_DELAY_MS = 2_000;

/** Sau khi app khởi động lại: job đang RUNNING mà không còn tiến trình nào chạy → quay về PENDING. */
export async function resetStuckJobs(db: PrismaClient): Promise<void> {
  await db.recomputeJob.updateMany({ where: { status: "RUNNING" }, data: { status: "PENDING" } });
}

interface RunStats {
  done: number;
  /** Job gặp EngineBusyError: để lại PENDING, thử lại ở lượt sau. */
  busy: number;
}

async function runJobs(db: PrismaClient): Promise<RunStats> {
  const stats: RunStats = { done: 0, busy: 0 };
  const skipped: number[] = []; // job bận trong lượt này — không nhận lại ngay (tránh quay vòng nóng)
  for (;;) {
    const claimed = await db.$queryRaw<{ id: number; periodId: number; productId: number; fromAt: Date }[]>`
      UPDATE recompute_jobs
         SET status = 'RUNNING', attempts = attempts + 1, "updatedAt" = now()
       WHERE id = (SELECT id FROM recompute_jobs
                    WHERE status = 'PENDING' AND NOT (id = ANY(${skipped}::int[]))
                    ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, "periodId", "productId", "fromAt"`;
    const job = claimed[0];
    if (!job) return stats;
    try {
      await withInventoryTx(
        db,
        {
          periodId: job.periodId, userId: SYSTEM_USER_ID, products: [job.productId], mode: "worker",
          // flush đã gộp + xoá job và mở cờ (absorbRecomputeJob) khi mã còn cờ; dọn lại cho chắc trường hợp job tồn tại
          // mà cờ đã tắt (dữ liệu bất thường) — idempotent
          finalize: async (ctx) => {
            await ctx.tx.recomputeJob.deleteMany({ where: { id: job.id } });
            await ctx.tx.product.update({ where: { id: job.productId }, data: { recomputing: false } });
          },
        },
        // Mốc thật đọc lại DƯỚI khoá mã trong flush (absorbRecomputeJob) — `job.fromAt` lúc nhận có thể đã cũ
        async (ctx) => markDirty(ctx, job.productId, job.fromAt),
      );
      stats.done++;
    } catch (e) {
      if (e instanceof EngineBusyError) {
        await db.recomputeJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { status: "PENDING" } });
        skipped.push(job.id);
        stats.busy++;
        continue;
      }
      // Lỗi thật: FAILED + GIỮ cờ recomputing (chặn xuất) để người vận hành xử lý — không nuốt lỗi, không thử lại mãi
      console.error("[recompute] job lỗi", job, e);
      const msg = e instanceof Error ? e.message : String(e);
      await db.recomputeJob.updateMany({ where: { id: job.id }, data: { status: "FAILED", error: msg.slice(0, 500) } });
    }
  }
}

/**
 * Xử lý hết job PENDING (mỗi job = 1 transaction giữ khoá mã hàng, không giới hạn ngưỡng). Trả số job đã tính xong.
 * Job lỗi → FAILED + giữ cờ recomputing (chặn xuất). Job gặp kho bận (EngineBusyError) → về PENDING, bỏ qua trong
 * lượt này (kickRecomputeWorker hẹn giờ chạy lại).
 */
export async function runRecomputeJobs(db: PrismaClient): Promise<number> {
  return (await runJobs(db)).done;
}

let running = false;
let again = false;

/**
 * Đánh thức worker (không chạy chồng trong 1 tiến trình). Gọi sau commit và khi app khởi động. Được đánh thức khi đang
 * chạy ⇒ chạy thêm 1 lượt sau lượt hiện tại (job ghi sau lần nhận cuối không bị bỏ sót).
 */
export function kickRecomputeWorker(db?: PrismaClient): void {
  if (process.env.RECOMPUTE_WORKER === "off") return; // test: tự gọi runRecomputeJobs để kiểm soát thời điểm
  if (running) { again = true; return; }
  running = true;
  again = false;
  setImmediate(() => {
    void (async () => {
      let busy = 0;
      try {
        const client = db ?? (await import("@/lib/prisma")).prisma;
        busy = (await runJobs(client)).busy;
      } catch (e) {
        console.error("[recompute]", e);
      } finally {
        running = false;
      }
      if (again) kickRecomputeWorker(db);
      else if (busy > 0) setTimeout(() => kickRecomputeWorker(db), BUSY_RETRY_DELAY_MS).unref();
    })();
  });
}
