import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { ValidationError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { creditSectionSchema, ownerSectionSchema, profileSectionSchema, statusSectionSchema } from "@/server/partners/schemas";
import { promoteRegularRetail } from "@/server/partners/regular-retail";
import { setPartnerActive, setPartnerCredit, setPartnerOwner, updatePartnerProfile } from "@/server/partners/service";

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("partner.manage"); const id = idParam.parse((await ctx.params).id); const raw = await readJson(req); const section = z.object({ section: z.string().optional() }).parse(raw).section;
  await prisma.$transaction(async (tx) => {
    switch (section) {
      case "profile": return updatePartnerProfile(tx, actor, id, profileSectionSchema.parse(raw));
      case "credit": return setPartnerCredit(tx, actor, id, creditSectionSchema.parse(raw));
      case "owner": return setPartnerOwner(tx, actor, id, ownerSectionSchema.parse(raw));
      case "status": return setPartnerActive(tx, actor, id, statusSectionSchema.parse(raw));
      case "promote": return promoteRegularRetail(tx, actor, id);
      default: throw new ValidationError("Phần dữ liệu không hợp lệ.");
    }
  });
});
