import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { createProductSchema } from "@/server/products/schemas";
import { createProductIdempotent } from "@/server/products/service";
export const POST = apiHandler(async (req) => createProductIdempotent(prisma, await requireActorApi("product.manage"), readIdempotencyKey(req), createProductSchema.parse(await readJson(req))));
