import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";
import { apiHandler } from "@/server/http/handler";

export const dynamic = "force-dynamic";

/**
 * Kiểu gia công cho dòng bán (tôn xốp…): người bán không cần quyền quản trị danh mục.
 * `?productId=` ⇒ chỉ kiểu gia công mà sản phẩm đó CÓ định mức (BOM) — chọn kiểu khác sẽ bị chặn khi lập đơn nên không hiển thị.
 */
export const GET = apiHandler(async (req) => {
  await requireActorApi("order.create");
  const all = await listActiveOptions(prisma, "processing-types");
  const raw = new URL(req.url).searchParams.get("productId");
  if (raw === null) return all;
  const productId = Number(raw);
  if (!Number.isInteger(productId) || productId <= 0) return [];
  const boms = await prisma.bom.findMany({ where: { productId, versions: { some: { status: "ACTIVE" } } }, select: { processingTypeId: true } });
  const allowed = new Set(boms.map((b) => b.processingTypeId));
  return all.filter((o) => allowed.has(Number(o.value)));
});
