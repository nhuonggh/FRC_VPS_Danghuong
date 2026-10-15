import { OpeningPage } from "@/components/opening/OpeningPage";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listOpening } from "@/server/opening/queries";

export const dynamic = "force-dynamic";

export default async function OpeningStockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const onlyDemo = (await searchParams).demo === "1";
  const actor = await requireActor("data.import");
  return <OpeningPage kind="stock" data={await listOpening(prisma, "stock", { onlyDemo })} canForce={actor.perms.has("period.close")} onlyDemo={onlyDemo} />;
}
