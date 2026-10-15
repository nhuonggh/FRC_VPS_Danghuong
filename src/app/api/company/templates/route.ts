import { prisma } from "@/lib/prisma";
import { createTemplateSchema } from "@/server/company/schemas";
import { createPrintTemplateIdempotent } from "@/server/company/service";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";

export const POST = apiHandler(async (req) =>
  createPrintTemplateIdempotent(prisma, await requireActorApi("company.manage"), readIdempotencyKey(req), createTemplateSchema.parse(await readJson(req))),
{ noStore: true });
