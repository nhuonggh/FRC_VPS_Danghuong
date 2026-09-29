import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { cancelDeliveryNote } from "@/server/delivery/service";
import { apiHandler } from "@/server/http/handler";
import { idParam } from "@/server/http/read-json";

export const POST = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("order.edit");
  const id = idParam.parse((await ctx.params).id);
  await prisma.$transaction((tx) => cancelDeliveryNote(tx, actor, id));
  return { ok: true };
});
