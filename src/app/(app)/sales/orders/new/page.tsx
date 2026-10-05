import { SaleOrderForm } from "@/components/sales/SaleOrderForm";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { loadSaleFormOptions } from "@/server/sales/form-options";

export const dynamic = "force-dynamic";

export default async function NewSaleOrderPage() {
  const actor = await requireActor("order.create");
  return <SaleOrderForm today={ictYmd(new Date())} canEditPrice={actor.perms.has("order.edit_price")} options={await loadSaleFormOptions(prisma, actor)} />;
}
