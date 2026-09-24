import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam } from "@/server/http/read-json";
import { resetPassword } from "@/server/users/service";

export const POST = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("user.manage");
  const id = idParam.parse((await ctx.params).id);
  return prisma.$transaction((tx) => resetPassword(tx, actor, id)); // { tempPassword } — hiện 1 lần
});
