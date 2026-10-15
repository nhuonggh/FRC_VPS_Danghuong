import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions/guard";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { parseKindParam } from "@/server/partners/kind-param";
import { searchPartners } from "@/server/partners/queries";
export const dynamic = "force-dynamic";
/**
 * Tìm đối tác cho ô chọn. Nhà cung cấp: người lập phiếu nhập (`purchase.create`) tìm được MỌI NCC dù thiếu `partner.view`/`partner.view_all`
 * (NCC không có "người phụ trách" như khách nên không áp phạm vi "khách của mình"). Khách hàng: vẫn cần `partner.view`, theo phạm vi cũ.
 */
export const GET = apiHandler(async (req, ctx: { params: Promise<{ kind: string }> }) => {
  const actor = await requireActorApi(), kind = parseKindParam((await ctx.params).kind);
  const buyer = kind === "supplier" && actor.perms.has("purchase.create");
  if (!buyer) assertCan(actor.perms, "partner.view");
  return searchPartners(prisma, buyer ? { ...actor, perms: new Set([...actor.perms, "partner.view_all"]) } : actor, { q: new URL(req.url).searchParams.get("q") ?? "", kind });
});
