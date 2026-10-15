import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
import { exportRollsXlsx } from "@/server/inventory-reports/export";

export const dynamic = "force-dynamic";
export async function GET(req: Request) { try { await requireActorApi("stock.view"); const q = new URL(req.url).searchParams.get("q") ?? ""; return xlsxResponse("tra-cuu-cuon.xlsx", await exportRollsXlsx(prisma, q)); } catch (error) { return toErrorResponse(error); } }
