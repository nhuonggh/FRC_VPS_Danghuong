import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
import { exportOnHandXlsx } from "@/server/inventory-reports/export";

export const dynamic = "force-dynamic";
export async function GET(req: Request) { try { const actor = await requireActorApi("stock.view"), params: Record<string, string[]> = {}; for (const [key, value] of new URL(req.url).searchParams) (params[key] ??= []).push(value); return xlsxResponse("dinh-muc-ton.xlsx", await exportOnHandXlsx(prisma, actor, parseListParams(params), true)); } catch (error) { return toErrorResponse(error); } }
