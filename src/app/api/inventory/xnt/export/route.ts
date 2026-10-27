import { prisma } from "@/lib/prisma";
import { listTimeRange, parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
import { exportXntXlsx } from "@/server/inventory-reports/export";

export const dynamic = "force-dynamic";
export async function GET(req: Request) { try {
  const actor = await requireActorApi("stock.view");
  const raw: Record<string, string[]> = {};
  for (const [key, value] of new URL(req.url).searchParams) (raw[key] ??= []).push(value);
  const parsed = parseListParams(raw, ["group"]), params = listTimeRange(parsed) ? parsed : { ...parsed, timePreset: "today" as const, timeStart: undefined, timeEnd: undefined };
  const range = listTimeRange(params)!;
  return xlsxResponse("xuat-nhap-ton.xlsx", await exportXntXlsx(prisma, actor, range.start, range.end, params.q, params.filters.group));
} catch (error) { return toErrorResponse(error); } }
