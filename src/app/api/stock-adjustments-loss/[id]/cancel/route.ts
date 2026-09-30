import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { cancelLossSchema } from "@/server/stock-adjust/schemas";
import { cancelLossAdjust } from "@/server/stock-adjust/service";

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  await cancelLossAdjust(prisma, await requireActorApi("stock_adjust.manage"), idParam.parse((await ctx.params).id), cancelLossSchema.parse(await readJson(req)).reason);
  return { ok: true };
});
