import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { assertReferenceCostRead, createReferenceCostPlan, referenceCostPlanSchema, usedReferenceCostPlanIds } from "@/server/processing/reference-cost-plans";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const GET = apiHandler(async (_req, ctx: Context) => {
  const actor = await requireActorApi(); assertReferenceCostRead(actor);
  const productId = idParam.parse((await ctx.params).id);
  const types = await prisma.productProcessingRatio.findMany({ where: { productId }, select: { processingTypeId: true } });
  const rows = await prisma.referenceCostPlan.findMany({
    where: { OR: [{ productId }, { productId: null, processingTypeId: { in: types.map(t => t.processingTypeId) } }] },
    orderBy: [{ validFrom: "desc" }, { id: "desc" }],
    include: { tonProduct: { select: { id: true, code: true, name: true } }, processingType: { select: { name: true } } },
    take: 200,
  });
  const used = await usedReferenceCostPlanIds(prisma, rows.map(r => r.id));
  return rows.map(r => ({ id: r.id, used: used.has(r.id), productId: r.productId, processingTypeId: r.processingTypeId, typeName: r.processingType.name,
    validFrom: r.validFrom.toISOString().slice(0, 10), ton: r.tonProduct ? { value: r.tonProduct.id, label: `${r.tonProduct.code} — ${r.tonProduct.name}` } : null,
    fixedPricePerM2: r.fixedPricePerM2?.toString() ?? null, tonQtyPerMeter: r.tonQtyPerMeter.toString(), feePerMeter: r.feePerMeter?.toString() ?? null, auxFixedPerMeter: r.auxFixedPerMeter?.toString() ?? null, note: r.note }));
}, { noStore: true });
export const POST = apiHandler(async (req, ctx: Context) => {
  const actor = await requireActorApi();
  const productId = idParam.parse((await ctx.params).id);
  const { processingTypeIds, ...body } = z.object({ processingTypeIds: z.array(z.number().int().positive()).min(1).max(30).optional() }).passthrough().parse(await readJson(req));
  // Một lần lưu cho nhiều kiểu gia công: cùng cấu hình, tạo mỗi kiểu một phiên bản; lỗi một kiểu thì không lưu kiểu nào.
  const inputs = (processingTypeIds ? [...new Set(processingTypeIds)] : [undefined]).map(id => referenceCostPlanSchema.parse(id === undefined ? body : { ...body, processingTypeId: id }));
  return prisma.$transaction(async tx => {
    const ids: number[] = [];
    for (const input of inputs) ids.push((await createReferenceCostPlan(tx, actor, productId, input)).id);
    return { id: ids[0]!, ids };
  });
}, { noStore: true });
