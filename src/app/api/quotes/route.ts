import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { quoteSchema } from "@/server/quotes/schemas";
import { createQuoteIdempotent } from "@/server/quotes/service";

export const POST = apiHandler(async (req) =>
  createQuoteIdempotent(prisma, await requireActorApi("quote.manage"), readIdempotencyKey(req), quoteSchema.parse(await readJson(req))),
);
