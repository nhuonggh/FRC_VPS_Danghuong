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
  const [boms, ratios, types] = await Promise.all([
    prisma.bom.findMany({ where: { productId, versions: { some: { status: "ACTIVE" } } }, select: { processingTypeId: true } }),
    prisma.productProcessingRatio.findMany({ where: { productId }, select: { processingTypeId: true, ratio: true } }),
    prisma.processingType.findMany({ select: { id: true, ratio: true } }),
  ]);
  const withBom = new Set(boms.map((b) => b.processingTypeId));
  const ratioOf = new Map(ratios.map((r) => [r.processingTypeId, Number(r.ratio)]));
  const defaultOf = new Map(types.map((t) => [t.id, t.ratio === null ? null : Number(t.ratio)]));
  // Tỷ lệ riêng của sản phẩm ưu tiên; chưa có thì dùng tỷ lệ mặc định của kiểu gia công; chưa có nữa ⇒ null (form mặc định 1).
  return all.map((o) => ({ ...o, ratio: ratioOf.get(Number(o.value)) ?? defaultOf.get(Number(o.value)) ?? null, hasBom: withBom.has(Number(o.value)) }));
});
