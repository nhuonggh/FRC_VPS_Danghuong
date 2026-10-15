import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { cancelDeposit } from "@/server/deposits/service";
import { apiHandler } from "@/server/http/handler";
import { idParam } from "@/server/http/read-json";

export const POST = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("deposit.manage");
  const id = idParam.parse((await ctx.params).id);
  await prisma.$transaction((tx) => cancelDeposit(tx, actor, id));
  return { ok: true };
});
