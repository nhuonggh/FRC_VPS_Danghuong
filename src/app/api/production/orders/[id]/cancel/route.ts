import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { cancelProductionSchema } from "@/server/production/schemas";
import { cancelProductionOrderTx } from "@/server/production/service";

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  await cancelProductionOrderTx(prisma, await requireActorApi("production.manage"), idParam.parse((await ctx.params).id), cancelProductionSchema.parse(await readJson(req)).reason);
  return { ok: true };
});
