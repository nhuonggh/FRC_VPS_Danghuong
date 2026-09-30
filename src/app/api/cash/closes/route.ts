import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { createCashCloseIdempotent } from "@/server/cash/close";
import { cashCloseSchema } from "@/server/cash/schemas";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";

export const POST = apiHandler(async (req) => createCashCloseIdempotent(prisma, await requireActorApi("cash.close"), readIdempotencyKey(req), cashCloseSchema.parse(await readJson(req))));
