import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";
import { stocktakeSchema } from "@/server/stocktake/schemas";
import { createStocktake } from "@/server/stocktake/service";

// Lập nháp không đụng kho ⇒ không cần khoá idempotency (chốt phiếu mới cần).
export const POST = apiHandler(async (req) => createStocktake(prisma, await requireActorApi("stocktake.manage"), stocktakeSchema.parse(await readJson(req))));
