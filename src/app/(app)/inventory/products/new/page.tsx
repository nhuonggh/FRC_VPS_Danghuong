import { ProductNewForm } from "@/components/products/ProductNewForm";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";
export default async function NewProductPage() { await requireActor("product.manage"); return <ProductNewForm groups={await listActiveOptions(prisma, "product-groups")} />; }
