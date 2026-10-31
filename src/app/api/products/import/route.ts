import type { NextRequest } from "next/server";
import { assertCan } from "@/lib/permissions/guard";
import { requireActorApi } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/handler";
import { handleImportPost } from "@/server/import/handle";
import { productImportSpec } from "@/server/products/import-spec";
export async function POST(req: NextRequest) { try { const actor = await requireActorApi("data.import"); assertCan(actor.perms, "product.manage"); return await handleImportPost(req, actor, productImportSpec({ canPrice: actor.perms.has("purchase_price.view") })); } catch (error) { return toErrorResponse(error); } }
