import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam } from "@/server/http/read-json";
import { confirmDraftOrderTx } from "@/server/sales/lifecycle";

/** Xác nhận đơn nháp ⇒ xuất kho FIFO ngay (D-25). */
export const POST = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("order.create");
  return confirmDraftOrderTx(prisma, actor, idParam.parse((await ctx.params).id));
});
