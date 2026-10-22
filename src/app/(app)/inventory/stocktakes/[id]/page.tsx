import { notFound } from "next/navigation";
import { StocktakeDetail } from "@/components/stocktake/StocktakeDetail";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { canPrintDoc } from "@/server/print/types";
import { getStocktake } from "@/server/stocktake/queries";

export default async function StocktakeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("stocktake.manage"), raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0) notFound();
  const st = await getStocktake(prisma, actor, Number(raw)).catch((error) => { if (error instanceof DomainError && error.status === 404) notFound(); throw error; });
  return <StocktakeDetail st={st} canPrint={canPrintDoc(actor.perms, "STOCKTAKE")} />;
}
