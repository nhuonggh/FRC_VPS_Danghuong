import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { assertReferenceCostRead } from "@/server/processing/reference-cost-plans";
import { searchProducts } from "@/server/products/queries";
export const GET = apiHandler(async req => {
  const actor = await requireActorApi(); assertReferenceCostRead(actor);
  return searchProducts(prisma, { q: new URL(req.url).searchParams.get("q") ?? "", capability: "canUseAsMaterial" });
}, { noStore: true });
