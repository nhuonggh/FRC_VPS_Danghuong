import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { adjustmentInSchema, createAdjustmentInIdempotent } from "@/server/purchase/adjustment-in";
export const POST = apiHandler(async (req) => createAdjustmentInIdempotent(prisma, await requireActorApi("stock_adjust.manage"), readIdempotencyKey(req), adjustmentInSchema.parse(await readJson(req))));
