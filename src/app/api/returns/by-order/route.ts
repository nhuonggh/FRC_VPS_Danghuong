import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { returnByOrderSchema } from "@/server/returns/schemas";
import { createReturnByOrderIdempotent } from "@/server/returns/service";

export const POST = apiHandler(async (req) =>
  createReturnByOrderIdempotent(prisma, await requireActorApi("return.manage"), readIdempotencyKey(req), returnByOrderSchema.parse(await readJson(req))),
);
