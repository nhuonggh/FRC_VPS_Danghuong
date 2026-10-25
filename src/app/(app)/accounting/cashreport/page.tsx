import { CashReport } from "@/components/cash/CashReport";
import { prisma } from "@/lib/prisma";
import { parseTimedListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { cashReport } from "@/server/cash/report";

export const dynamic = "force-dynamic";

export default async function CashReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("cashbook.view");
  const sp = await searchParams;
  const raw = Array.isArray(sp.account) ? sp.account[0] : sp.account;
  const account = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  const params = parseTimedListParams(sp, []);
  const report = await cashReport(prisma, actor, account, params);
  return <CashReport report={report} params={params} base="/accounting/cashreport" />;
}
