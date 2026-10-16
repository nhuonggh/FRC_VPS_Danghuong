import type { ProductKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { searchProducts } from "@/server/products/queries";
import { isProductCapability } from "@/server/products/capabilities";
export const dynamic = "force-dynamic"; const KINDS = new Set(["HANG", "NVL", "THANH_PHAM", "PHU_KIEN"]);
export const GET = apiHandler(async (req) => { await requireActorApi("product.view"); const sp = new URL(req.url).searchParams, kinds = (sp.get("kinds") ?? "").split(",").filter((kind): kind is ProductKind => KINDS.has(kind)); const capability = sp.get("capability") ?? ""; return searchProducts(prisma, { q: sp.get("q") ?? "", kinds, capability: isProductCapability(capability) ? capability : undefined }); });
