import { notFound } from "next/navigation";
import { LossAdjustDetail } from "@/components/stock-adjust/LossAdjustDetail";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { canPrintDoc } from "@/server/print/types";
import { getLossAdjust } from "@/server/stock-adjust/service";

export default async function LossAdjustmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("stock_adjust.manage"), raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0) notFound();
  const adj = await getLossAdjust(prisma, actor, Number(raw)).catch((error) => { if (error instanceof DomainError && error.status === 404) notFound(); throw error; });
  return <LossAdjustDetail adj={adj} canPrint={canPrintDoc(actor.perms, "LOSS_ADJUST")} />;
}
