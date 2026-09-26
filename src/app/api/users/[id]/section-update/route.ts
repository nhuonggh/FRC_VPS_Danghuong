import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { ValidationError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { emailSectionSchema, profileSectionSchema, rolesSectionSchema } from "@/server/users/schemas";
import { setUserEmail, setUserRoles, updateProfile } from "@/server/users/service";

const envelope = z.object({ section: z.string().optional() });

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("user.manage");
  const id = idParam.parse((await ctx.params).id);
  const raw = await readJson(req);
  const { section } = envelope.parse(raw);
  // Chỉ ghi các field thuộc đúng `section` (full-page-detail.md mục 4)
  switch (section) {
    case "profile": {
      const v = profileSectionSchema.parse(raw);
      await prisma.$transaction((tx) => updateProfile(tx, actor, id, v));
      return { ok: true };
    }
    case "email": {
      // Email = khoá đăng nhập Google: chỉ user.manage (đầu route), rào đặc quyền + audit trong setUserEmail
      const v = emailSectionSchema.parse(raw);
      await prisma.$transaction((tx) => setUserEmail(tx, actor, id, v.email));
      return { ok: true };
    }
    case "roles": {
      const v = rolesSectionSchema.parse(raw);
      await prisma.$transaction((tx) => setUserRoles(tx, actor, id, v.roleIds));
      return { ok: true };
    }
    default:
      throw new ValidationError("Phần dữ liệu không hợp lệ.");
  }
});
