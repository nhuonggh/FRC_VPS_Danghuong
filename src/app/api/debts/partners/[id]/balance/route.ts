import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { partnerBalances } from "@/server/debt/queries";
import { apiHandler } from "@/server/http/handler";

export const dynamic = "force-dynamic";
/** Công nợ hiện tại của một đối tác (hiện ở phiếu nhập). Không có quyền xem công nợ → null, form tự ẩn dòng này. */
export const GET = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi();
  if (!actor.perms.has("debt.view")) return { balance: null };
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id < 1) return { balance: null };
  if (!(await prisma.partner.findFirst({ where: { id, isSupplier: true }, select: { id: true } }))) return { balance: null }; // chỉ NCC: khách còn phụ thuộc phạm vi "khách của mình"
  const found = (await partnerBalances(prisma, [id])).get(id)!;
  return { balance: found.balance.toString() };
}, { noStore: true });
