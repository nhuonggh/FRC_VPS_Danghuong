import { TripList } from "@/components/trips/TripList";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listTripFilterOptions, listTripOptions, listTrips, TRIP_FILTER_KEYS } from "@/server/trips/queries";

export const dynamic = "force-dynamic";

export default async function TripsListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("trip.manage");
  const params = parseListParams(await searchParams, TRIP_FILTER_KEYS);
  const [data, options, filters] = await Promise.all([listTrips(prisma, actor, params), listTripOptions(prisma), listTripFilterOptions(prisma, actor)]);
  return <TripList title="Danh sách chuyến" base="/delivery/trips" rows={data.rows} total={data.total} stats={data.stats} params={params} vehicles={options.vehicles} customers={filters.customers} routes={filters.routes} canCreate={actor.perms.has("trip.manage")} />;
}
