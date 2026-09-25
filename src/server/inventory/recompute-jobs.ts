import type { EngineCtx } from "./types";

/*
 * Thao tác hàng đợi tính lại nền TRONG giao dịch kho (Task 8). Tách khỏi recompute.ts để unit-of-work.ts import tĩnh
 * mà không vòng import (recompute.ts cần withInventoryTx). Mọi hàm ở đây yêu cầu ĐANG giữ khoá advisory của mã hàng
 * (flush khoá trước khi gọi) ⇒ mọi thay đổi job/cờ của một mã được tuần tự hoá theo khoá mã đó.
 */

/**
 * Tính lại quá ngưỡng đồng bộ: đánh dấu mã hàng "đang tính lại" + tạo/gộp job; đánh thức worker SAU commit.
 * Cờ `recomputing` CHẶN lệnh xuất mã đó (postIssue → ProductRecomputingError) tới khi worker tính xong.
 */
export async function deferRecompute(ctx: EngineCtx, productId: number, fromAt: Date): Promise<void> {
  await ctx.tx.product.update({ where: { id: productId }, data: { recomputing: true } });
  await mergeRecomputeJob(ctx, productId, fromAt);
  ctx.afterCommit.push(() => {
    // import động: recompute.ts import unit-of-work.ts (vòng import) — chỉ cần lúc chạy
    void import("./recompute")
      .then((m) => m.kickRecomputeWorker())
      .catch((e: unknown) => console.error("[recompute] không đánh thức được worker:", e));
  });
}

/**
 * Thêm thay đổi vào job của mã (mỗi mã tối đa 1 job — UNIQUE productId): giữ mốc SỚM NHẤT. Job FAILED giữ nguyên
 * FAILED (chờ người vận hành); job RUNNING bị một worker nhận trước đó quay về PENDING — worker đó đọc lại mốc dưới
 * khoá mã (absorbRecomputeJob) nên vẫn tính cả thay đổi này.
 */
export async function mergeRecomputeJob(ctx: EngineCtx, productId: number, fromAt: Date): Promise<void> {
  const existing = await ctx.tx.recomputeJob.findUnique({ where: { productId } });
  if (!existing) {
    await ctx.tx.recomputeJob.create({ data: { periodId: ctx.period.id, productId, fromAt } });
    return;
  }
  await ctx.tx.recomputeJob.update({
    where: { productId },
    data: {
      fromAt: fromAt < existing.fromAt ? fromAt : existing.fromAt,
      status: existing.status === "FAILED" ? "FAILED" : "PENDING",
    },
  });
}

/**
 * Worker sắp tính lại một mã đang cờ `recomputing` (job của chính nó, hoặc mã khác bị lan truyền giá chạm tới): tính
 * lại TỪNG PHẦN chỉ đúng khi mốc ≤ MỌI thay đổi chưa tính của mã ⇒ lấy min(fromAt, mốc job) đọc DƯỚI khoá mã (không
 * dùng mốc cũ lúc nhận job — giao dịch đồng bộ có thể đã gộp mốc sớm hơn), rồi xoá job + mở cờ trong CÙNG giao dịch
 * (rollback ⇒ job và cờ còn nguyên). Cờ bật mà không có job (dữ liệu bất thường) ⇒ tính lại từ đầu kỳ cho chắc.
 */
export async function absorbRecomputeJob(ctx: EngineCtx, productId: number, fromAt: Date): Promise<Date> {
  const job = await ctx.tx.recomputeJob.findUnique({ where: { productId } });
  const from = !job ? ctx.period.openedAt : job.fromAt < fromAt ? job.fromAt : fromAt;
  if (job) await ctx.tx.recomputeJob.delete({ where: { id: job.id } });
  await ctx.tx.product.update({ where: { id: productId }, data: { recomputing: false } });
  return from;
}
