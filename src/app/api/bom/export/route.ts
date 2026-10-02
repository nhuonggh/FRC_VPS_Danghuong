import { prisma } from "@/lib/prisma";
import { exportBomXlsx } from "@/server/bom/export";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
export const dynamic = "force-dynamic";
export async function GET() { try { await requireActorApi("bom.manage"); return xlsxResponse("dinh-muc.xlsx", await exportBomXlsx(prisma)); } catch (error) { return toErrorResponse(error); } }
