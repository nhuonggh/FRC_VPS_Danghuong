import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { quoteStatusSchema } from "@/server/quotes/schemas";
import { setQuoteStatus } from "@/server/quotes/service";

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("quote.manage");
  const id = idParam.parse((await ctx.params).id);
  const { status } = quoteStatusSchema.parse(await readJson(req));
  await prisma.$transaction((tx) => setQuoteStatus(tx, actor, id, status));
  return { ok: true };
});
