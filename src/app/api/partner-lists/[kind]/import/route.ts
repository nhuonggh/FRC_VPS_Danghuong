import type { NextRequest } from "next/server";
import { assertCan } from "@/lib/permissions/guard";
import { requireActorApi } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/handler";
import { handleImportPost } from "@/server/import/handle";
import { parseKindParam } from "@/server/partners/kind-param";
import { partnerImportSpec } from "@/server/partners/import-spec";
export async function POST(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) { try { const actor = await requireActorApi("data.import"); assertCan(actor.perms, "partner.manage"); return await handleImportPost(req, actor, partnerImportSpec(parseKindParam((await ctx.params).kind))); } catch (error) { return toErrorResponse(error); } }
