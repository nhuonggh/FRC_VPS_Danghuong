import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam } from "@/server/http/read-json";
import { deleteRole } from "@/server/roles/service";

export const DELETE = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("role.manage");
  const id = idParam.parse((await ctx.params).id);
  await prisma.$transaction((tx) => deleteRole(tx, actor, id));
  return { ok: true };
});
