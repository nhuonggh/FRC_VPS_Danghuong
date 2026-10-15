import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { debtAdjustmentSchema } from "@/server/debt/schemas";
import { createDebtAdjustmentIdempotent } from "@/server/debt/service";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";

export const POST = apiHandler(async (req) =>
  createDebtAdjustmentIdempotent(prisma, await requireActorApi("debt.adjust"), readIdempotencyKey(req), debtAdjustmentSchema.parse(await readJson(req))),
);
