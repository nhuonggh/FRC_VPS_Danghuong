import { notFound, redirect } from "next/navigation";
import { TripDetail } from "@/components/trips/TripDetail";
import { prisma } from "@/lib/prisma";
import { ClosedPeriodBanner } from "@/components/period/PeriodHistoryViews";
import { requireActor } from "@/server/auth/session";
import { closedPeriodOf } from "@/server/period/doc-period";
import { listActiveCashAccounts, listExpenseTypes } from "@/server/cash/queries";
import { DomainError } from "@/server/http/errors";
import { canPrintDoc } from "@/server/print/types";
import { getTrip } from "@/server/trips/queries";

export const dynamic = "force-dynamic";

export default async function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const p = actor.perms;
  if (!p.has("trip.manage") && !p.has("trip.settle") && !p.has("trip.confirm_cash")) redirect("/403");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) notFound();
  const trip = await getTrip(prisma, actor, id).catch((e: unknown) => { if (e instanceof DomainError && e.status === 404) return null; throw e; });
  if (!trip) notFound();
  const accounts = await listActiveCashAccounts(prisma);
  const closed = await closedPeriodOf(prisma, "trip", id);
  return (
    <>
      {closed && <div className="mb-4"><ClosedPeriodBanner periodName={closed.name} closedAt={closed.closedAt} /></div>}
      <TripDetail trip={trip} accounts={accounts} expenseTypes={await listExpenseTypes(prisma)} perms={{ canManage: !closed && p.has("trip.manage"), canSettle: !closed && p.has("trip.settle"), canConfirm: !closed && p.has("trip.confirm_cash"), canPrint: canPrintDoc(p, "TRIP_SHEET"), canPrintCash: canPrintDoc(p, "TRIP_CASH") }} />
    </>
  );
}
