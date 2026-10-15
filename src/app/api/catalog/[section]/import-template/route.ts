import { getSection } from "@/config/catalog-sections";
import { requireActorApi } from "@/server/auth/session";
import { catalogImportSpec } from "@/server/catalog/import-spec";
import { DomainError } from "@/server/http/errors";
import { toErrorResponse } from "@/server/http/handler";
import { handleTemplateGet } from "@/server/import/handle";
export async function GET(_req: Request, ctx: { params: Promise<{ section: string }> }) { try { await requireActorApi("data.import"); const { section } = await ctx.params; if (!getSection(section)) throw new DomainError("Không tìm thấy mục danh mục.", 404); return await handleTemplateGet(catalogImportSpec(section)); } catch (error) { return toErrorResponse(error); } }
