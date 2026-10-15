import { prisma } from "@/lib/prisma";
import { updateTemplateSchema } from "@/server/company/schemas";
import { updatePrintTemplate } from "@/server/company/service";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("company.manage");
  const id = idParam.parse((await ctx.params).id);
  const input = updateTemplateSchema.parse(await readJson(req));
  await prisma.$transaction((tx) => updatePrintTemplate(tx, actor, id, input));
  return { ok: true };
}, { noStore: true });
