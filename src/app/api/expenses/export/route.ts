import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { exportExpensesXlsx } from "@/server/cash/expense-export";
import { EXPENSE_FILTER_KEYS } from "@/server/cash/queries";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const actor = await requireActorApi("expense.manage");
    const params: Record<string, string[]> = {};
    for (const [key, value] of new URL(req.url).searchParams) (params[key] ??= []).push(value);
    return xlsxResponse("chi-phi.xlsx", await exportExpensesXlsx(prisma, actor, parseListParams(params, EXPENSE_FILTER_KEYS)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
