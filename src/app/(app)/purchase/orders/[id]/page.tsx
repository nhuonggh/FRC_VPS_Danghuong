import { notFound } from "next/navigation";
import { canPrintDoc } from "@/server/print/types";
import { PurchaseDetail } from "@/components/purchase/PurchaseDetail";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { ClosedPeriodBanner } from "@/components/period/PeriodHistoryViews";
import { requireActor } from "@/server/auth/session";
import { closedPeriodOf } from "@/server/period/doc-period";
import { DomainError } from "@/server/http/errors";
import { getPurchase } from "@/server/purchase/queries";
import { productOptionsByIds } from "@/server/products/queries";

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("purchase.view"), raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0) notFound();
  const purchase = await getPurchase(prisma, actor, Number(raw)).catch((error) => { if (error instanceof DomainError && error.status === 404) notFound(); throw error; });
  const products = await productOptionsByIds(prisma, purchase.lines.map((line) => line.productId));
  const closed = await closedPeriodOf(prisma, "purchase", Number(raw));
  const canEdit = !closed && actor.perms.has("purchase.edit") && actor.perms.has("purchase_price.view");
  return (
    <>
      {closed && <div className="mb-4"><ClosedPeriodBanner periodName={closed.name} closedAt={closed.closedAt} /></div>}
      <PurchaseDetail purchase={purchase} products={products} date={ictYmd(purchase.at)} canEdit={canEdit} canCancel={!closed && actor.perms.has("purchase.cancel")} canPrint={canPrintDoc(actor.perms, "PURCHASE_RECEIPT")} />
    </>
  );
}
