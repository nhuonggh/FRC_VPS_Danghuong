import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam } from "@/server/http/read-json";
import { deleteReferenceCostPlan } from "@/server/processing/reference-cost-plans";

export const dynamic = "force-dynamic";
export const DELETE = apiHandler(async (_req, ctx: { params: Promise<{ id: string; planId: string }> }) => {
  const actor = await requireActorApi();
  const { id, planId } = await ctx.params;
  return prisma.$transaction(tx => deleteReferenceCostPlan(tx, actor, idParam.parse(id), idParam.parse(planId)));
}, { noStore: true });
