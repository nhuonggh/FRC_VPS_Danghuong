import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { cancelSaleOrderTx } from "@/server/sales/lifecycle";
import { cancelOrderSchema } from "@/server/sales/schemas";

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("order.cancel");
  const id = idParam.parse((await ctx.params).id);
  await cancelSaleOrderTx(prisma, actor, id, cancelOrderSchema.parse(await readJson(req)).reason);
  return { ok: true };
});
