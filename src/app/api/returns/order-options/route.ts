import { prisma } from "@/lib/prisma";
import { partnerScopeWhere } from "@/lib/permissions/scope";
import { searchTextWhere } from "@/lib/search";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { searchReturnableOrders } from "@/server/returns/queries";

export const dynamic = "force-dynamic";
export const GET = apiHandler(async (req) => {
  const actor = await requireActorApi("return.manage");
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").slice(0, 100);
  const undelivered = sp.get("undelivered") === "1";
  if (sp.get("type") === "customers") {
    const rows = await prisma.partner.findMany({ where: { AND: [partnerScopeWhere(actor), searchTextWhere(q), { saleOrders: { some: { isCancelled: false, isDraft: false, ...(!undelivered ? { deliveryStatus: { in: ["PARTIAL", "DELIVERED"] as ("PARTIAL" | "DELIVERED")[] } } : {}) } } }] }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" }, take: 20 });
    return rows.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));
  }
  const raw = sp.get("partnerId");
  if (raw && (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 2147483647)) return [];
  return (await searchReturnableOrders(prisma, actor, q, raw ? Number(raw) : undefined, undelivered)).map((o) => ({ value: o.id, label: `${o.code} — ${o.partnerName}` }));
}, { noStore: true });
