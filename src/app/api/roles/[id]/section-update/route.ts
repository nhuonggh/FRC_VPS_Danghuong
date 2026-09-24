import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { ValidationError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { roleInfoSchema, rolePermissionsSchema } from "@/server/roles/schemas";
import { updateRoleInfo, updateRolePermissions } from "@/server/roles/service";

const envelope = z.object({ section: z.string().optional() });

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("role.manage");
  const id = idParam.parse((await ctx.params).id);
  const raw = await readJson(req);
  const { section } = envelope.parse(raw);
  if (section === "info") {
    const v = roleInfoSchema.parse(raw);
    await prisma.$transaction((tx) => updateRoleInfo(tx, actor, id, v));
    return { ok: true };
  }
  if (section === "permissions") {
    const v = rolePermissionsSchema.parse(raw);
    await prisma.$transaction((tx) => updateRolePermissions(tx, actor, id, v.codes));
    return { ok: true };
  }
  throw new ValidationError("Phần dữ liệu không hợp lệ.");
});
