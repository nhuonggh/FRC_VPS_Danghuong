import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
import { exportReportXlsx } from "@/server/reports/export";
import { REPORT_FILTER_KEYS } from "@/server/reports/types";

export const dynamic = "force-dynamic";
export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  try {
    const actor = await requireActorApi();
    const key = (await ctx.params).key;
    const q: Record<string, string[]> = {};
    for (const [k, v] of new URL(req.url).searchParams) (q[k] ??= []).push(v);
    return xlsxResponse(`bao-cao-${key}.xlsx`, await exportReportXlsx(prisma, actor, key, parseListParams(q, REPORT_FILTER_KEYS)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
