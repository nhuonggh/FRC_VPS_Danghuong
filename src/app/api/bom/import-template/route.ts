import { bomImportSpec } from "@/server/bom/import-spec";
import { requireActorApi } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/handler";
import { handleTemplateGet } from "@/server/import/handle";
export async function GET() { try { await requireActorApi("data.import"); return await handleTemplateGet(bomImportSpec()); } catch (error) { return toErrorResponse(error); } }
