import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { returnByProductSchema } from "@/server/returns/schemas";
import { createReturnByProductIdempotent } from "@/server/returns/service";

export const POST = apiHandler(async (req) =>
  createReturnByProductIdempotent(prisma, await requireActorApi("return.manage"), "BY_PRODUCT", readIdempotencyKey(req), returnByProductSchema.parse(await readJson(req))),
);
