import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam } from "@/server/http/read-json";
import { restoreSaleOrderTx } from "@/server/sales/lifecycle";

export const POST = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("order.restore");
  await restoreSaleOrderTx(prisma, actor, idParam.parse((await ctx.params).id));
  return { ok: true };
});
