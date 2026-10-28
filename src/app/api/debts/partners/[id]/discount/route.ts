import { partnerScopeWhere } from "@/lib/permissions/scope";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { discountBalance } from "@/server/debt/balance";
import { apiHandler } from "@/server/http/handler";

export const dynamic = "force-dynamic";
/** Số dư chiết khấu tích lũy của một đối tác (form Điều chỉnh công nợ, lý do "Trừ bằng chiết khấu tích lũy"). */
export const GET = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("debt.adjust");
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id < 1) return { balance: null };
  if (!(await prisma.partner.findFirst({ where: { id, ...partnerScopeWhere(actor) }, select: { id: true } }))) return { balance: null };
  return { balance: (await discountBalance(prisma, id)).toString() };
}, { noStore: true });
