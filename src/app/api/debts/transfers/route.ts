import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { debtTransferSchema } from "@/server/debt/schemas";
import { createDebtTransferIdempotent } from "@/server/debt/service";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";

export const POST = apiHandler(async (req) =>
  createDebtTransferIdempotent(prisma, await requireActorApi("debt.adjust"), readIdempotencyKey(req), debtTransferSchema.parse(await readJson(req))),
);
