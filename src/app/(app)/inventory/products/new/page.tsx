import { ProductNewForm } from "@/components/products/ProductNewForm";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";
export default async function NewProductPage() { const actor = await requireActor("product.manage"); const [groups, units] = await Promise.all([listActiveOptions(prisma, "product-groups"), listActiveOptions(prisma, "units")]); return <ProductNewForm groups={groups} units={units.map((u) => u.label)} canCatalog={actor.perms.has("catalog.manage")} canSeePurchase={actor.perms.has("purchase_price.view")} canSeeSale={actor.perms.has("sale_price.view")} />; }
