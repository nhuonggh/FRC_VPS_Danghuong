import { redirect } from "next/navigation";
import { PurchaseNewForm } from "@/components/purchase/PurchaseNewForm";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";

export default async function NewPurchasePage() {
  const actor = await requireActor("purchase.create");
  if (!actor.perms.has("purchase_price.view")) redirect("/403");
  return <PurchaseNewForm today={ictYmd(new Date())} />;
}
