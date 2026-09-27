import { requireActorApi } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/handler";
import { handleTemplateGet } from "@/server/import/handle";
import { parseKindParam } from "@/server/partners/kind-param";
import { partnerImportSpec } from "@/server/partners/import-spec";
export async function GET(_req: Request, ctx: { params: Promise<{ kind: string }> }) { try { await requireActorApi("data.import"); return await handleTemplateGet(partnerImportSpec(parseKindParam((await ctx.params).kind))); } catch (error) { return toErrorResponse(error); } }
