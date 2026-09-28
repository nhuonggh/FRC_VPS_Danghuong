import { notFound } from "next/navigation";
import { ProductDetail } from "@/components/products/ProductDetail";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { getProduct } from "@/server/products/queries";
import { productStock } from "@/server/inventory-reports/product-stock";
const validId = (value: string) => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2_147_483_647;
export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) { const actor = await requireActor("product.view"), raw = (await params).id; if (!validId(raw)) notFound(); try { const product = await getProduct(prisma, Number(raw)); const stock = actor.perms.has("stock.view") ? await productStock(prisma, actor, product.id) : null; return <ProductDetail product={product} canManage={actor.perms.has("product.manage")} stock={stock} />; } catch { notFound(); } }
