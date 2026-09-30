import { notFound } from "next/navigation";
import { canPrintDoc } from "@/server/print/types";
import { PurchaseDetail } from "@/components/purchase/PurchaseDetail";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getPurchase } from "@/server/purchase/queries";
import { productOptionsByIds } from "@/server/products/queries";

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("purchase.view"), raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0) notFound();
  const purchase = await getPurchase(prisma, actor, Number(raw)).catch((error) => { if (error instanceof DomainError && error.status === 404) notFound(); throw error; });
  const products = await productOptionsByIds(prisma, purchase.lines.map((line) => line.productId));
  const canEdit = actor.perms.has("purchase.edit") && actor.perms.has("purchase_price.view");
  return <PurchaseDetail purchase={purchase} products={products} date={ictYmd(purchase.at)} canEdit={canEdit} canCancel={actor.perms.has("purchase.cancel")} canPrint={canPrintDoc(actor.perms, "PURCHASE_RECEIPT")} />;
}
