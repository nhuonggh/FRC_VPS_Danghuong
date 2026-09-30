import { OpeningPage } from "@/components/opening/OpeningPage";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listOpening } from "@/server/opening/queries";

export const dynamic = "force-dynamic";

export default async function OpeningMaterialPage() {
  const actor = await requireActor("data.import");
  return <OpeningPage kind="material" data={await listOpening(prisma, "material")} canForce={actor.perms.has("period.close")} />;
}
