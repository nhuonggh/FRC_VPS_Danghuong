import { OpeningPage } from "@/components/opening/OpeningPage";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listOpening } from "@/server/opening/queries";

export const dynamic = "force-dynamic";

export default async function OpeningCashPage() {
  const actor = await requireActor("data.import");
  return <OpeningPage kind="cash" data={await listOpening(prisma, "cash")} canForce={actor.perms.has("period.close")} />;
}
