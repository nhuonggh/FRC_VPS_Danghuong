import type { NextRequest } from "next/server";
import { assertCan } from "@/lib/permissions/guard";
import { bomImportSpec } from "@/server/bom/import-spec";
import { requireActorApi } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/handler";
import { handleImportPost } from "@/server/import/handle";
export async function POST(req: NextRequest) { try { const actor = await requireActorApi("data.import"); assertCan(actor.perms, "bom.manage"); return await handleImportPost(req, actor, bomImportSpec()); } catch (error) { return toErrorResponse(error); } }
