import type { NextRequest } from "next/server";
import { requireActorApi } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/handler";
import { handleImportPost } from "@/server/import/handle";
import { legacyOptions, openingSpec, parseOpeningKind } from "@/server/opening/registry";
export async function POST(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) { try { const actor = await requireActorApi("data.import"); const kind = parseOpeningKind((await ctx.params).kind); return await handleImportPost(req, actor, openingSpec(kind, { actor, force: new URL(req.url).searchParams.get("force") === "1", legacy: legacyOptions(req.url, kind) })); } catch (error) { return toErrorResponse(error); } }
