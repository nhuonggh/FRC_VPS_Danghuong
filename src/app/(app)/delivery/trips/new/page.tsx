import { TripForm } from "@/components/trips/TripForm";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { listTripOptions } from "@/server/trips/queries";

export const dynamic = "force-dynamic";

export default async function NewTripPage() {
  await requireActor("trip.manage");
  return <TripForm today={ictYmd(new Date())} options={await listTripOptions(prisma)} />;
}
