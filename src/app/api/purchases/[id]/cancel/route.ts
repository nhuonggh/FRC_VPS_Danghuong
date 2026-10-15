import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { cancelPurchaseSchema } from "@/server/purchase/schemas";
import { cancelPurchaseTx } from "@/server/purchase/service";

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("purchase.cancel");
  await cancelPurchaseTx(prisma, actor, idParam.parse((await ctx.params).id), cancelPurchaseSchema.parse(await readJson(req)).reason);
  return { ok: true };
});
