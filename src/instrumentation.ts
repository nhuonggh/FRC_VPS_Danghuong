/**
 * Next 15 gọi 1 lần khi server khởi động: dọn job tính lại nền bị kẹt, đánh thức worker, bật quét định kỳ.
 * Không bao giờ làm hỏng khởi động: bootRecomputeWorker tự bắt lỗi (DB chưa sẵn sàng → log + thử lại sau).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { bootRecomputeWorker } = await import("@/server/inventory");
    await bootRecomputeWorker();
  } catch (e) {
    console.error("[recompute] không khởi động được worker tính lại nền:", e);
  }
}
