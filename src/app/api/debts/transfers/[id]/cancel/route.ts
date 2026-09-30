import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { cancelDebtSchema } from "@/server/debt/schemas";
import { cancelDebtTransfer } from "@/server/debt/service";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("debt.adjust");
  const id = idParam.parse((await ctx.params).id);
  const { reason } = cancelDebtSchema.parse(await readJson(req));
  await prisma.$transaction((tx) => cancelDebtTransfer(tx, actor, id, reason));
  return { ok: true };
});
