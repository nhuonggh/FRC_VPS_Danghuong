import { TripResultsView } from "@/components/trips/TripResultsView";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { RESULT_TRIP_TABS } from "@/lib/trip-results";
import { requireActor } from "@/server/auth/session";
import { listActiveCashAccounts } from "@/server/cash/queries";
import { closedPeriodOf } from "@/server/period/doc-period";
import { getTrip, listTripFilterOptions, listTripOptions, listTrips, TRIP_RESULTS_FILTER_KEYS } from "@/server/trips/queries";

export const dynamic = "force-dynamic";
export default async function TripResultsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("trip.manage");
  const params = parseListParams(await searchParams, TRIP_RESULTS_FILTER_KEYS);
  const tab = RESULT_TRIP_TABS.find((t) => t.key === params.filters.resultState?.[0]) ?? RESULT_TRIP_TABS[0];
  const effective = { ...params, filters: { ...params.filters, status: tab.statuses } };
  const [data, options, filters] = await Promise.all([listTrips(prisma, actor, effective, { resultsSummary: true }), listTripOptions(prisma), listTripFilterOptions(prisma, actor)]);
  const id = Number(params.filters.detail?.[0]);
  const canLoad = Number.isSafeInteger(id) && data.rows.some((r) => r.id === id);
  const [detail, accounts, closed] = canLoad ? await Promise.all([getTrip(prisma, actor, id), listActiveCashAccounts(prisma), closedPeriodOf(prisma, "trip", id)]) : [null, [], null];
  return <TripResultsView rows={data.rows} total={data.total} stats={data.stats} summary={data.resultsSummary!} params={params} vehicles={options.vehicles} customers={filters.customers} routes={filters.routes} detail={detail} accounts={accounts} closedPeriodName={closed?.name} />;
}
