import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";
import { apiHandler } from "@/server/http/handler";

export const dynamic = "force-dynamic";

/**
 * Kiểu gia công cho dòng bán (tôn xốp…): người bán không cần quyền quản trị danh mục.
 * `?productId=` ⇒ kèm `ratio` (tỷ lệ m²/md đã lưu cho sản phẩm × kiểu này, null = chưa khai báo ⇒ form mặc định 1) và
 * `hasBom` (có định mức hiệu lực ⇒ xuất NVL theo định mức; không có ⇒ bán như hàng thường, kiểu gia công chỉ ghi trên dòng).
 */
export const GET = apiHandler(async (req) => {
  await requireActorApi("order.create");
  const all = await listActiveOptions(prisma, "processing-types");
  const raw = new URL(req.url).searchParams.get("productId");
  if (raw === null) return all;
  const productId = Number(raw);
  if (!Number.isInteger(productId) || productId <= 0) return [];
  const [boms, ratios] = await Promise.all([
    prisma.bom.findMany({ where: { productId, versions: { some: { status: "ACTIVE" } } }, select: { processingTypeId: true } }),
    prisma.productProcessingRatio.findMany({ where: { productId }, select: { processingTypeId: true, ratio: true } }),
  ]);
  const withBom = new Set(boms.map((b) => b.processingTypeId));
  const ratioOf = new Map(ratios.map((r) => [r.processingTypeId, Number(r.ratio)]));
  return all.map((o) => ({ ...o, ratio: ratioOf.get(Number(o.value)) ?? null, hasBom: withBom.has(Number(o.value)) }));
});
