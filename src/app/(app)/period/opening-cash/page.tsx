import { OpeningPage } from "@/components/opening/OpeningPage";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listOpening } from "@/server/opening/queries";

export const dynamic = "force-dynamic";

export default async function OpeningCashPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const onlyDemo = (await searchParams).demo === "1";
  const actor = await requireActor("data.import");
  return <OpeningPage kind="cash" data={await listOpening(prisma, "cash", { onlyDemo })} canForce={actor.perms.has("period.close")} onlyDemo={onlyDemo} />;
}
