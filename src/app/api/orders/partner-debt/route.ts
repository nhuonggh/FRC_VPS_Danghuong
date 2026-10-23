import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions/guard";
import { partnerScopeWhere } from "@/lib/permissions/scope";
import { requireActorApi } from "@/server/auth/session";
import { partnerBalance } from "@/server/debt/balance";
import { apiHandler } from "@/server/http/handler";

export const dynamic = "force-dynamic";

/** Công nợ cũ của khách (dương = khách nợ mình) để hiện ở màn lập đơn — chỉ trả khi actor có quyền xem công nợ và thấy được khách này. */
export const GET = apiHandler(async (req) => {
  const actor = await requireActorApi();
  if (!actor.perms.has("order.create")) throw new ForbiddenError("order.create");
  if (!actor.perms.has("debt.view")) return null;
  const id = new URL(req.url).searchParams.get("partnerId");
  const partnerId = id && /^\d{1,10}$/.test(id) && Number(id) > 0 && Number(id) <= 2_147_483_647 ? Number(id) : null;
  if (!partnerId) return null;
  const visible = await prisma.partner.findFirst({ where: { id: partnerId, ...partnerScopeWhere(actor) }, select: { id: true } });
  if (!visible) return null;
  return { balance: (await partnerBalance(prisma, partnerId)).balance.toString() };
}, { noStore: true });
