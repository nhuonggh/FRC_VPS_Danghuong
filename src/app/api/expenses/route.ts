import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { createExpenseIdempotent, expenseSchema } from "@/server/cash/expenses";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";

export const POST = apiHandler(async (req) => createExpenseIdempotent(prisma, await requireActorApi("expense.manage"), readIdempotencyKey(req), expenseSchema.parse(await readJson(req))));
