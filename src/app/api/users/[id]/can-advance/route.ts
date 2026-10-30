import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { setCanAdvance } from "@/server/users/service";

const body = z.object({ canAdvance: z.boolean() });

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("user.manage");
  const id = idParam.parse((await ctx.params).id);
  const { canAdvance } = body.parse(await readJson(req));
  await prisma.$transaction((tx) => setCanAdvance(tx, actor, id, canAdvance));
  return { ok: true };
});
