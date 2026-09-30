import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { exportCashBookXlsx } from "@/server/cash/export";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const actor = await requireActorApi("cashbook.view");
    const q = new URL(req.url).searchParams;
    const account = Number(q.get("account"));
    return xlsxResponse(q.get("type") === "BANK" ? "so-tien-gui-ngan-hang.xlsx" : "so-quy-tien-mat.xlsx", await exportCashBookXlsx(prisma, actor, q.get("type") === "BANK" ? "BANK" : "CASH", Number.isInteger(account) && account > 0 ? account : null));
  } catch (error) {
    return toErrorResponse(error);
  }
}
