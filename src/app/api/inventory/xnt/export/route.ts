import { prisma } from "@/lib/prisma";
import { ictStartOfDay, toIct } from "@/lib/time";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
import { exportXntXlsx } from "@/server/inventory-reports/export";

export const dynamic = "force-dynamic";
export async function GET() { try { const actor = await requireActorApi("stock.view"), now = toIct(new Date()), from = ictStartOfDay(now.y, now.m, 1); return xlsxResponse("xuat-nhap-ton.xlsx", await exportXntXlsx(prisma, actor, from, new Date())); } catch (error) { return toErrorResponse(error); } }
