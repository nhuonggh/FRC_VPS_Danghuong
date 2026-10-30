import type { NextRequest } from "next/server";
import { requireActorApi } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/handler";
import { handleTemplateGet } from "@/server/import/handle";
import { legacyOptions, openingSpec, parseOpeningKind } from "@/server/opening/registry";
export async function GET(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) { try { const actor = await requireActorApi("data.import"); const kind = parseOpeningKind((await ctx.params).kind); return await handleTemplateGet(openingSpec(kind, { actor, force: false, legacy: legacyOptions(req.url, kind) })); } catch (error) { return toErrorResponse(error); } }
