import { requireActorApi } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { DAILY_FILTER_KEYS } from "@/server/home/daily-config";
import { exportDaily } from "@/server/home/daily-export";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const actor = await requireActorApi();
    const url = new URL(req.url), query: Record<string, string[]> = {};
    for (const [k, v] of url.searchParams) (query[k] ??= []).push(v);
    return xlsxResponse("kiem-tra-hang-ngay.xlsx", await exportDaily(prisma, actor, url.searchParams.get("item"), parseListParams(query, DAILY_FILTER_KEYS), new Date()));
  } catch (error) { return toErrorResponse(error); }
}
