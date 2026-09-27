import { requireActorApi } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/handler";
import { handleTemplateGet } from "@/server/import/handle";
import { productImportSpec } from "@/server/products/import-spec";
export async function GET() { try { await requireActorApi("data.import"); return await handleTemplateGet(productImportSpec()); } catch (error) { return toErrorResponse(error); } }
