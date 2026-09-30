import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { quoteSchema } from "@/server/quotes/schemas";
import { updateQuote } from "@/server/quotes/service";

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("quote.manage");
  const id = idParam.parse((await ctx.params).id);
  const input = quoteSchema.parse(await readJson(req));
  return prisma.$transaction((tx) => updateQuote(tx, actor, id, input));
});
