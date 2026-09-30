import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { editExpense, expenseSchema } from "@/server/cash/expenses";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";

export const PATCH = apiHandler<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const actor = await requireActorApi("expense.manage");
  const id = idParam.parse((await ctx.params).id);
  const input = expenseSchema.parse(await readJson(req));
  await prisma.$transaction((tx) => editExpense(tx, actor, id, input));
  return { id };
});
