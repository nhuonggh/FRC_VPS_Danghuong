/** Next 15 gọi 1 lần khi server khởi động: dọn job tính lại nền bị kẹt (app sập giữa chừng) rồi đánh thức worker. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { prisma } = await import("@/lib/prisma");
  const { resetStuckJobs, kickRecomputeWorker } = await import("@/server/inventory/recompute");
  await resetStuckJobs(prisma);
  kickRecomputeWorker(prisma);
}
