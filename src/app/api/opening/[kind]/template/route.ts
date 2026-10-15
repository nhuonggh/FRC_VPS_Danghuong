import type { NextRequest } from "next/server";
import { requireActorApi } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/handler";
import { handleTemplateGet } from "@/server/import/handle";
import { openingSpec, parseOpeningKind } from "@/server/opening/registry";
export async function GET(_req: NextRequest, ctx: { params: Promise<{ kind: string }> }) { try { const actor = await requireActorApi("data.import"); return await handleTemplateGet(openingSpec(parseOpeningKind((await ctx.params).kind), { actor, force: false })); } catch (error) { return toErrorResponse(error); } }
