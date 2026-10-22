import { notFound } from "next/navigation";
import { ProductionOrderDetail } from "@/components/production/ProductionOrderDetail";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { canPrintDoc } from "@/server/print/types";
import { getProductionOrder } from "@/server/production/queries";

export default async function ProductionOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("production.manage"), raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0) notFound();
  const order = await getProductionOrder(prisma, actor, Number(raw)).catch((error) => { if (error instanceof DomainError && error.status === 404) notFound(); throw error; });
  return <ProductionOrderDetail order={order} canPrint={canPrintDoc(actor.perms, "PRODUCTION_ORDER")} />;
}
