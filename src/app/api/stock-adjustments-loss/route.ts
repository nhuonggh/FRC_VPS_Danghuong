import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { lossAdjustSchema } from "@/server/stock-adjust/schemas";
import { createLossAdjustIdempotent } from "@/server/stock-adjust/service";

export const POST = apiHandler(async (req) => createLossAdjustIdempotent(prisma, await requireActorApi("stock_adjust.manage"), readIdempotencyKey(req), lossAdjustSchema.parse(await readJson(req))));
