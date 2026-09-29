import { prisma } from "@/lib/prisma";
import { cancelBomVersion } from "@/server/bom";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam } from "@/server/http/read-json";

export const POST = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("bom.manage");
  const id = idParam.parse((await ctx.params).id);
  await prisma.$transaction((tx) => cancelBomVersion(tx, actor, id));
  return { ok: true };
});
