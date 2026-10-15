import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
import { exportPurchasesXlsx } from "@/server/purchase/export";
import { PURCHASE_FILTER_KEYS } from "@/server/purchase/queries";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const actor = await requireActorApi("purchase.view");
    const params: Record<string, string[]> = {};
    for (const [key, value] of new URL(req.url).searchParams) (params[key] ??= []).push(value);
    return xlsxResponse("phieu-nhap.xlsx", await exportPurchasesXlsx(prisma, actor, parseListParams(params, PURCHASE_FILTER_KEYS)));
  } catch (error) { return toErrorResponse(error); }
}
