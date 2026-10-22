import { notFound } from "next/navigation";
import { DiscountDetail } from "@/components/discount/DiscountDetail";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { listActiveCashAccounts } from "@/server/cash/queries";
import { canPrintDoc } from "@/server/print/types";
import { getDiscountDetail } from "@/server/discount/queries";
import { DomainError } from "@/server/http/errors";

export const dynamic = "force-dynamic";

export default async function DiscountDetailPage({ params, searchParams }: { params: Promise<{ partnerId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("debt.view");
  const id = Number((await params).partnerId);
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) notFound();
  const d = await getDiscountDetail(prisma, actor, id, parseListParams(await searchParams, [])).catch((e: unknown) => { if (e instanceof DomainError && e.status === 404) return null; throw e; });
  if (!d) notFound();
  const accounts = (await listActiveCashAccounts(prisma)).map((a) => ({ id: a.id, name: a.name }));
  return <DiscountDetail d={d} accounts={accounts} today={ictYmd(new Date())} perms={{ canSettle: actor.perms.has("discount.settle"), canReconcile: actor.perms.has("discount.reconcile"), canViewProfit: actor.perms.has("profit.view"), canPrint: canPrintDoc(actor.perms, "DISCOUNT_SETTLEMENT") }} />;
}
