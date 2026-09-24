import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { setLocked } from "@/server/users/service";

const body = z.object({ locked: z.boolean() });

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("user.manage");
  const id = idParam.parse((await ctx.params).id);
  const { locked } = body.parse(await readJson(req));
  await prisma.$transaction((tx) => setLocked(tx, actor, id, locked));
  return { ok: true };
});
