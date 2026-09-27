import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { purchaseInputSchema } from "@/server/purchase/schemas";
import { createPurchaseIdempotent } from "@/server/purchase/service";

export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("purchase.create");
  return createPurchaseIdempotent(prisma, actor, readIdempotencyKey(req), purchaseInputSchema.parse(await readJson(req)));
});
