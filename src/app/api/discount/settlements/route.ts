import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { settleSchema } from "@/server/discount/schemas";
import { settleDiscountIdempotent } from "@/server/discount/settle";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";

export const POST = apiHandler(async (req) => settleDiscountIdempotent(prisma, await requireActorApi("discount.settle"), readIdempotencyKey(req), settleSchema.parse(await readJson(req))));
