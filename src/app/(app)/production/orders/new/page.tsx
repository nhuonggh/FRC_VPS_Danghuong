import { ProductionOrderForm } from "@/components/production/ProductionOrderForm";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";

export default async function NewProductionOrderPage() {
  await requireActor("production.manage");
  return <ProductionOrderForm today={ictYmd(new Date())} />;
}
