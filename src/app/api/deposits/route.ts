import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { depositSchema } from "@/server/deposits/schemas";
import { createDepositIdempotent } from "@/server/deposits/service";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";

export const POST = apiHandler(async (req) =>
  createDepositIdempotent(prisma, await requireActorApi("deposit.manage"), readIdempotencyKey(req), depositSchema.parse(await readJson(req))),
);
