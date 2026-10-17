import { requireActor } from "@/server/auth/session";
import { SupplierOrderNew } from "@/components/purchase/SupplierOrderNew";
import { ictYmd } from "@/lib/time";
export default async function Page() {
  await requireActor("purchase.create"); await requireActor("purchase_price.view");
  return <SupplierOrderNew today={ictYmd(new Date())} />;
}
