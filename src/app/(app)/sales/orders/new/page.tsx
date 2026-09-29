import { SaleOrderForm } from "@/components/sales/SaleOrderForm";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";

export default async function NewSaleOrderPage() {
  const actor = await requireActor("order.create");
  return <SaleOrderForm today={ictYmd(new Date())} canEditPrice={actor.perms.has("order.edit_price")} />;
}
