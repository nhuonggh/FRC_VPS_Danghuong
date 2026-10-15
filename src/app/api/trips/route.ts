import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { tripSchema } from "@/server/trips/schemas";
import { createTripIdempotent } from "@/server/trips/service";

/** Xếp chuyến (38). */
export const POST = apiHandler(async (req) => createTripIdempotent(prisma, await requireActorApi("trip.manage"), readIdempotencyKey(req), tripSchema.parse(await readJson(req))));
