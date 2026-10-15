import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { exportDebtsXlsx } from "@/server/debt/export";
import { DEBT_FILTER_KEYS } from "@/server/debt/queries";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const actor = await requireActorApi("debt.view");
    const params: Record<string, string[]> = {};
    for (const [key, value] of new URL(req.url).searchParams) (params[key] ??= []).push(value);
    return xlsxResponse("cong-no.xlsx", await exportDebtsXlsx(prisma, actor, parseListParams(params, DEBT_FILTER_KEYS)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
