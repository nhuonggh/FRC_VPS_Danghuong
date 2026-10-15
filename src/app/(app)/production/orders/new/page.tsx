import { ProductionOrderForm } from "@/components/production/ProductionOrderForm";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { listActiveOptions } from "@/server/catalog/queries";

export default async function NewProductionOrderPage() {
  const actor = await requireActor("production.manage");
  const canCreateProduct = actor.perms.has("product.manage");
  const [groups, units] = canCreateProduct
    ? await Promise.all([listActiveOptions(prisma, "product-groups"), listActiveOptions(prisma, "units")])
    : [[], []];
  return <ProductionOrderForm today={ictYmd(new Date())} quickProduct={canCreateProduct ? { groups, units: units.map((u) => u.label), canSeePurchase: actor.perms.has("purchase_price.view") } : undefined} />;
}
