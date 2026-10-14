import { TripForm } from "@/components/trips/TripForm";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { listTripOptions } from "@/server/trips/queries";

export const dynamic = "force-dynamic";

export default async function NewTripPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireActor("trip.manage");
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 200) ?? "";
  return <TripForm key={q} today={ictYmd(new Date())} initialSearch={q} options={await listTripOptions(prisma)} />;
}
