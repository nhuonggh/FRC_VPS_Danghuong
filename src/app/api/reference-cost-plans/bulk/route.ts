import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { assertReferenceCostRead, bulkCreateReferenceCostPlans, bulkReferenceCostPlanSchema, referenceCostCandidates } from "@/server/processing/reference-cost-plans";

export const dynamic = "force-dynamic";
/** Tìm sản phẩm đã gắn kiểu gia công (đơn vị mét dài) để chọn nhiều. */
export const GET = apiHandler(async req => {
  const actor = await requireActorApi(); assertReferenceCostRead(actor);
  const sp = new URL(req.url).searchParams;
  const rows = await referenceCostCandidates(prisma, idParam.parse(sp.get("processingTypeId")), { q: sp.get("q") ?? "" });
  return rows.map(p => ({ value: p.id, label: `${p.code} — ${p.name}`, hint: p.baseUnit }));
}, { noStore: true });
export const POST = apiHandler(async req => {
  const actor = await requireActorApi();
  const input = bulkReferenceCostPlanSchema.parse(await readJson(req));
  return prisma.$transaction(tx => bulkCreateReferenceCostPlans(tx, actor, input), { timeout: 120_000 });
}, { noStore: true });
