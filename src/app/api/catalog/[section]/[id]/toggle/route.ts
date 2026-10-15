import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { setCatalogActive } from "@/server/catalog/service";

const body = z.object({ active: z.boolean() });
export const POST = apiHandler(async (req, ctx: { params: Promise<{ section: string; id: string }> }) => {
  const actor = await requireActorApi("catalog.manage");
  const { section, id: rawId } = await ctx.params;
  const { active } = body.parse(await readJson(req));
  await prisma.$transaction((tx) => setCatalogActive(tx, actor, section, idParam.parse(rawId), active));
  return { ok: true };
});
