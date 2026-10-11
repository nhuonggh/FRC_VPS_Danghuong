import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions/guard";
import { requireActorApi } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";
import { apiHandler } from "@/server/http/handler";

export const dynamic = "force-dynamic";

/**
 * Kiểu gia công cho dòng bán / dòng nhập (tôn xốp…): người bán, người nhập hàng không cần quyền quản trị danh mục.
 * `?productId=` ⇒ kèm `ratio` (tỷ lệ m²/md đã lưu cho sản phẩm × kiểu này, null = chưa khai báo ⇒ form mặc định 1) và
 * `hasBom` (có định mức hiệu lực ⇒ xuất NVL theo định mức; không có ⇒ bán như hàng thường, kiểu gia công chỉ ghi trên dòng).
 */
export const GET = apiHandler(async (req) => {
  const actor = await requireActorApi();
  if (!actor.perms.has("order.create") && !actor.perms.has("purchase.create")) throw new ForbiddenError("order.create");
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
  const linked = new Map(ratios.map((r) => [r.processingTypeId, r.ratio === null ? null : Number(r.ratio)]));
  const defaultOf = new Map(types.map((t) => [t.id, t.ratio === null ? null : Number(t.ratio)]));
  // Chỉ hiện kiểu đã gắn cho sản phẩm (Sản phẩm → tab Gia công). Tỷ lệ riêng ưu tiên; chưa có thì mặc định của kiểu; chưa có nữa ⇒ null (form mặc định 1).
  return all.filter((o) => linked.has(Number(o.value))).map((o) => ({ ...o, ratio: linked.get(Number(o.value)) ?? defaultOf.get(Number(o.value)) ?? null, hasBom: withBom.has(Number(o.value)) }));
});
