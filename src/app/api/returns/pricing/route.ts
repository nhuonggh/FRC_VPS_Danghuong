import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { returnPricing } from "@/server/returns/pricing";

export const dynamic = "force-dynamic";
const positiveInt = (v: string | null) => (v && /^\d{1,10}$/.test(v) && Number(v) > 0 && Number(v) <= 2_147_483_647 ? Number(v) : null);

/** Gợi ý đơn giá cho màn trả theo sản phẩm (kind=CUSTOMER) và trả NCC (kind=SUPPLIER); thiếu quyền xem giá ⇒ null. */
export const GET = apiHandler(async (req) => {
  const actor = await requireActorApi("return.manage");
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind") === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER";
  const partnerId = positiveInt(sp.get("partnerId")), productId = positiveInt(sp.get("productId"));
  if (!partnerId || !productId) return null;
  return returnPricing(prisma, actor, kind, partnerId, productId);
}, { noStore: true });
