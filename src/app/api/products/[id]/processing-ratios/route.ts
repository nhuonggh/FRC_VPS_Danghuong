import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { setProcessingRatio, unlinkProcessingType } from "@/server/bom/service";
import { requireActorApi } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";

export const dynamic = "force-dynamic";

/**
 * Kiểu gia công của sản phẩm. Trả MỌI kiểu đang dùng, `linked` = sản phẩm đã gắn kiểu đó (chỉ kiểu đã gắn mới hiện ở màn bán);
 * `ratio` null = chưa khai báo riêng ⇒ dùng tỷ lệ mặc định của kiểu (`defaultRatio`), chưa có nữa thì màn bán dùng 1.
 */
export const GET = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("product.view");
  const productId = idParam.parse((await ctx.params).id);
  const [types, rows, defaults, stats] = await Promise.all([
    listActiveOptions(prisma, "processing-types"),
    prisma.productProcessingRatio.findMany({ where: { productId }, select: { processingTypeId: true, ratio: true } }),
    prisma.processingType.findMany({ select: { id: true, ratio: true } }),
    // Đơn giá bán thấp nhất / trung bình / cao nhất của SP theo từng kiểu (đơn đã lập, chưa huỷ) — chỉ với `sale_price.view`.
    actor.perms.has("sale_price.view") ? prisma.saleOrderLine.groupBy({ by: ["processingTypeId"], where: { productId, processingTypeId: { not: null }, order: { isCancelled: false, isDraft: false } }, _min: { salePrice: true }, _avg: { salePrice: true }, _max: { salePrice: true } }) : Promise.resolve(null),
  ]);
  const statOf = new Map((stats ?? []).map((s) => [s.processingTypeId, { min: s._min.salePrice?.toString() ?? null, avg: s._avg.salePrice?.toString() ?? null, max: s._max.salePrice?.toString() ?? null }]));
  const byType = new Map(rows.map((r) => [r.processingTypeId, r.ratio?.toString() ?? null]));
  const defaultOf = new Map(defaults.map((d) => [d.id, d.ratio?.toString() ?? null]));
  return types.map((t) => ({ processingTypeId: Number(t.value), name: t.label, linked: byType.has(Number(t.value)), ratio: byType.get(Number(t.value)) ?? null, defaultRatio: defaultOf.get(Number(t.value)) ?? null, stats: stats ? (statOf.get(Number(t.value)) ?? null) : undefined }));
});

/** Gắn kiểu cho sản phẩm và/hoặc sửa tỷ lệ riêng (`ratio` null = dùng mặc định của kiểu): cần `product.manage` hoặc `bom.manage`. */
export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("product.view");
  const productId = idParam.parse((await ctx.params).id);
  const b = z.object({ processingTypeId: z.number().int().positive(), ratio: z.number().nullable() }).parse(await readJson(req));
  return prisma.$transaction((tx) => setProcessingRatio(tx, actor, { productId, ...b, onlyIfMissing: false }));
});

/** Bỏ kiểu gia công khỏi sản phẩm. */
export const DELETE = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("product.view");
  const productId = idParam.parse((await ctx.params).id);
  const b = z.object({ processingTypeId: z.number().int().positive() }).parse(await readJson(req));
  return prisma.$transaction((tx) => unlinkProcessingType(tx, actor, { productId, ...b }));
});
