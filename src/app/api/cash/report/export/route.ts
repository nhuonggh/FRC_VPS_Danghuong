import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { exportCashReportXlsx } from "@/server/cash/report-export";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const actor = await requireActorApi("cashbook.view");
    const q = new URL(req.url).searchParams;
    const account = Number(q.get("account"));
    const sp = Object.fromEntries(q.entries());
    return xlsxResponse("bao-cao-quy-tien-mat.xlsx", await exportCashReportXlsx(prisma, actor, Number.isInteger(account) && account > 0 ? account : null, parseListParams(sp, [])));
  } catch (error) {
    return toErrorResponse(error);
  }
}
