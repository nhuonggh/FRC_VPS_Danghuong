import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { createPartnerSchema } from "@/server/partners/schemas";
import { createPartnerIdempotent } from "@/server/partners/service";

export const POST = apiHandler(async (req) => createPartnerIdempotent(prisma, await requireActorApi("partner.manage"), readIdempotencyKey(req), createPartnerSchema.parse(await readJson(req))));
