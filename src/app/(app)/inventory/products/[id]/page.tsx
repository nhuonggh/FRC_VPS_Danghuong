import { notFound } from "next/navigation";
import { ProductDetail } from "@/components/products/ProductDetail";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";
import { getProduct, redactPrices } from "@/server/products/queries";
import { getProductMovements, getProductPricing } from "@/server/products/activity";
import { productStock } from "@/server/inventory-reports/product-stock";
const validId = (value: string) => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2_147_483_647;
export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) { const actor = await requireActor("product.view"), raw = (await params).id; if (!validId(raw)) notFound(); try { const product = redactPrices(await getProduct(prisma, Number(raw)), actor.perms); const stock = actor.perms.has("stock.view") ? await productStock(prisma, actor, product.id) : null; const [pricing, movements] = await Promise.all([getProductPricing(prisma, actor, product.id), getProductMovements(prisma, actor, product.id)]); return <ProductDetail groups={await listActiveOptions(prisma, "product-groups")} units={(await listActiveOptions(prisma, "units")).map((u) => u.label)} canCatalog={actor.perms.has("catalog.manage")} product={product} canManage={actor.perms.has("product.manage")} stock={stock} pricing={pricing} movements={movements} />; } catch { notFound(); } }
