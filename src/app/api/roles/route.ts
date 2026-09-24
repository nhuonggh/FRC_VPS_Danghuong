import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";
import { roleInfoSchema } from "@/server/roles/schemas";
import { createRole } from "@/server/roles/service";

export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("role.manage");
  const input = roleInfoSchema.parse(await readJson(req));
  return prisma.$transaction((tx) => createRole(tx, actor, input));
});
