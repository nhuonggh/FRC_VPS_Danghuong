import { TripList } from "@/components/trips/TripList";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listTripOptions, listTrips, TRIP_FILTER_KEYS } from "@/server/trips/queries";

export const dynamic = "force-dynamic";

export default async function TripSettlementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("trip.settle");
  const params = parseListParams(await searchParams, TRIP_FILTER_KEYS);
  const [data, options] = await Promise.all([listTrips(prisma, actor, params, { statuses: ["RETURNED", "SETTLED"] }), listTripOptions(prisma)]);
  return <TripList title="Đối soát lái xe" base="/delivery/settlements" rows={data.rows} total={data.total} stats={data.stats} params={params} vehicles={options.vehicles} canCreate={actor.perms.has("trip.manage")} fixedStatus />;
}
