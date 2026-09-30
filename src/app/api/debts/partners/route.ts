import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { searchDebtPartners } from "@/server/debt/queries";
import { apiHandler } from "@/server/http/handler";

export const dynamic = "force-dynamic";
export const GET = apiHandler(async (req) => {
  const actor = await requireActorApi();
  if (!actor.perms.has("debt.view") && !actor.perms.has("debt.adjust")) return [];
  return searchDebtPartners(prisma, actor, new URL(req.url).searchParams.get("q") ?? "");
}, { noStore: true });
