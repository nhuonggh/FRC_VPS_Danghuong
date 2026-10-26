import { prisma } from "@/lib/prisma";
import { listTimeRange, parseTimedListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
import { exportXntDetailXlsx } from "@/server/inventory-reports/export";

export const dynamic = "force-dynamic";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) { try {
  const actor = await requireActorApi("stock.view");
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id) || Number(id) <= 0 || Number(id) > 2_147_483_647) return new Response("Not found", { status: 404 });
  const raw: Record<string, string[]> = {};
  for (const [key, value] of new URL(req.url).searchParams) (raw[key] ??= []).push(value);
  const range = listTimeRange(parseTimedListParams(raw))!;
  const file = await exportXntDetailXlsx(prisma, actor, Number(id), range.start, range.end);
  if (!file) return new Response("Not found", { status: 404 });
  return xlsxResponse(`xuat-nhap-ton-${file.code}.xlsx`, file.buffer);
} catch (error) { return toErrorResponse(error); } }
