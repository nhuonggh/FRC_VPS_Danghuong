import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions/guard";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { salePricing } from "@/server/sales/pricing";
import { docTimestamp } from "@/server/inventory/time";
import { z } from "zod";

export const dynamic = "force-dynamic";

const positiveInt = (v: string | null) => (v && /^\d{1,10}$/.test(v) && Number(v) > 0 && Number(v) <= 2_147_483_647 ? Number(v) : null);

/** Gợi ý cho màn bán hàng và báo giá: tồn, giá bán gần nhất, giá nhập gần nhất — mỗi thứ chỉ trả khi actor đủ quyền. */
export const GET = apiHandler(async (req) => {
  const actor = await requireActorApi(); // lập đơn HOẶC làm báo giá đều cần giá gợi ý
  if (!actor.perms.has("order.create") && !actor.perms.has("quote.manage")) throw new ForbiddenError("order.create");
  const sp = new URL(req.url).searchParams;
  const partnerId = positiveInt(sp.get("partnerId")), productId = positiveInt(sp.get("productId")), processingTypeId = positiveInt(sp.get("processingTypeId"));
  if (!partnerId || !productId) return null;
  const mode = z.enum(["LEGACY", "STOCK", "BOM"]).parse(sp.get("issueMode") ?? "LEGACY");
  const at = sp.get("date") ? docTimestamp(sp.get("date")!, new Date()) : new Date();
  return salePricing(prisma, actor, partnerId, productId, processingTypeId, at, mode);
}, { noStore: true });
