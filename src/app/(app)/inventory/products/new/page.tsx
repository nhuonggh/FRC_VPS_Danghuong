import { ProductNewForm } from "@/components/products/ProductNewForm";
import { requireActor } from "@/server/auth/session";
export default async function NewProductPage() { await requireActor("product.manage"); return <ProductNewForm />; }
