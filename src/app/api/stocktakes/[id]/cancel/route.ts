import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { cancelStocktakeSchema } from "@/server/stocktake/schemas";
import { cancelStocktake } from "@/server/stocktake/service";

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  await cancelStocktake(prisma, await requireActorApi("stocktake.manage"), idParam.parse((await ctx.params).id), cancelStocktakeSchema.parse(await readJson(req)).reason);
  return { ok: true };
});
