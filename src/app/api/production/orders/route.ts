import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { productionOrderSchema } from "@/server/production/schemas";
import { createProductionOrderIdempotent } from "@/server/production/service";

export const POST = apiHandler(async (req) => createProductionOrderIdempotent(prisma, await requireActorApi("production.manage"), readIdempotencyKey(req), productionOrderSchema.parse(await readJson(req))));
