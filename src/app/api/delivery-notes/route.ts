import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { deliveryNoteSchema } from "@/server/delivery/schemas";
import { createDeliveryNoteIdempotent } from "@/server/delivery/service";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";

export const POST = apiHandler(async (req) =>
  createDeliveryNoteIdempotent(prisma, await requireActorApi("order.edit"), readIdempotencyKey(req), deliveryNoteSchema.parse(await readJson(req))),
);
