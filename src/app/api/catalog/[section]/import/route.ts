import type { NextRequest } from "next/server";
import { assertCan } from "@/lib/permissions/guard";
import { getSection } from "@/config/catalog-sections";
import { requireActorApi } from "@/server/auth/session";
import { catalogImportSpec } from "@/server/catalog/import-spec";
import { DomainError } from "@/server/http/errors";
import { toErrorResponse } from "@/server/http/handler";
import { handleImportPost } from "@/server/import/handle";
export async function POST(req: NextRequest, ctx: { params: Promise<{ section: string }> }) { try { const actor = await requireActorApi("data.import"); assertCan(actor.perms, "catalog.manage"); const { section } = await ctx.params; if (!getSection(section)) throw new DomainError("Không tìm thấy mục danh mục.", 404); return await handleImportPost(req, actor, catalogImportSpec(section)); } catch (error) { return toErrorResponse(error); } }
