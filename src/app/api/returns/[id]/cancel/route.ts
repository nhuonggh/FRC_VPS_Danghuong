import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { cancelReturnSchema } from "@/server/returns/schemas";
import { cancelReturnTx } from "@/server/returns/service";

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("return.manage");
  await cancelReturnTx(prisma, actor, idParam.parse((await ctx.params).id), cancelReturnSchema.parse(await readJson(req)).reason);
  return { ok: true };
});
