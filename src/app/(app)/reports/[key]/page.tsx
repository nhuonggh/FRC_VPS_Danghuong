import { notFound, redirect } from "next/navigation";
import { ReportView } from "@/components/reports/ReportView";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { runReport } from "@/server/reports/queries";
import { REPORT_FILTER_KEYS, REPORTS } from "@/server/reports/types";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  const key = (await params).key;
  const def = REPORTS.find((r) => r.key === key);
  if (!def) notFound();
  if (!actor.perms.has(def.perm)) redirect("/403");
  const list = parseListParams(await searchParams, REPORT_FILTER_KEYS);
  const view = { ...list, timePreset: list.timePreset ?? ("thisMonth" as const) };
  const report = await runReport(prisma, actor, key, view);
  return <ReportView report={report} params={view} base={`/reports/${key}`} negFilter={key === "order-profit" || key === "consumption-compare"} showSearch={!["period-pnl", "production", "actual-consumption", "consumption-compare"].includes(key)} />;
}
