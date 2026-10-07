import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { setProcessingRatio } from "@/server/bom/service";
import { requireActorApi } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";

export const dynamic = "force-dynamic";

/** Tỷ lệ m²/md của sản phẩm theo từng kiểu gia công (null = chưa khai báo, màn bán mặc định 1). */
export const GET = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requireActorApi("product.view");
  const productId = idParam.parse((await ctx.params).id);
  const [types, rows] = await Promise.all([listActiveOptions(prisma, "processing-types"), prisma.productProcessingRatio.findMany({ where: { productId }, select: { processingTypeId: true, ratio: true } })]);
  const byType = new Map(rows.map((r) => [r.processingTypeId, r.ratio.toString()]));
  return types.map((t) => ({ processingTypeId: Number(t.value), name: t.label, ratio: byType.get(Number(t.value)) ?? null }));
});

/** Sửa tỷ lệ (nơi duy nhất sửa tỷ lệ đã có): cần `product.manage` hoặc `bom.manage`. */
export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("product.view");
  const productId = idParam.parse((await ctx.params).id);
  const b = z.object({ processingTypeId: z.number().int().positive(), ratio: z.number() }).parse(await readJson(req));
  return prisma.$transaction((tx) => setProcessingRatio(tx, actor, { productId, ...b, onlyIfMissing: false }));
});
