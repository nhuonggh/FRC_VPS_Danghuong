import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { parseKindParam } from "@/server/partners/kind-param";
import { searchPartners } from "@/server/partners/queries";
export const dynamic = "force-dynamic";
export const GET = apiHandler(async (req, ctx: { params: Promise<{ kind: string }> }) => searchPartners(prisma, await requireActorApi("partner.view"), { q: new URL(req.url).searchParams.get("q") ?? "", kind: parseKindParam((await ctx.params).kind) }));
