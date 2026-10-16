import { prisma } from "@/lib/prisma";
import { createBomBatchIdempotent } from "@/server/bom";
import { createBomBatchSchema } from "@/server/bom/schemas";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";

export const POST = apiHandler(async (req) =>
  createBomBatchIdempotent(prisma, await requireActorApi("bom.manage"), readIdempotencyKey(req), createBomBatchSchema.parse(await readJson(req))),
);
