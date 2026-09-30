import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { searchCashPartners } from "@/server/cash/queries";
import { apiHandler } from "@/server/http/handler";

export const GET = apiHandler(async (req) => {
  const actor = await requireActorApi("cash.transaction.create");
  const u = new URL(req.url).searchParams;
  const role = u.get("role");
  return searchCashPartners(prisma, actor, (u.get("q") ?? "").slice(0, 100), role === "customer" || role === "supplier" ? role : "any");
});
