import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { releaseDeposit } from "@/server/deposits/service";
import { apiHandler } from "@/server/http/handler";
import { idParam } from "@/server/http/read-json";

/** Chuyển cọc thành số dư của khách (gỡ khỏi đơn) — điều kiện để hủy đơn đang có cọc (34b). */
export const POST = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("deposit.manage");
  const id = idParam.parse((await ctx.params).id);
  await prisma.$transaction((tx) => releaseDeposit(tx, actor, id));
  return { ok: true };
});
