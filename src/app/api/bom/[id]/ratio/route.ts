import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { setProcessingRatio } from "@/server/bom/service";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { DomainError } from "@/server/http/errors";
import { idParam, readJson } from "@/server/http/read-json";

/** Người quản lý định mức sửa tỷ lệ m²/md (nơi DUY NHẤT sửa tỷ lệ đã có). */
export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("bom.manage");
  const id = idParam.parse((await ctx.params).id);
  const { ratio } = z.object({ ratio: z.number() }).parse(await readJson(req));
  return prisma.$transaction(async (tx) => {
    const bom = await tx.bom.findUnique({ where: { id }, select: { productId: true, processingTypeId: true } });
    if (!bom) throw new DomainError("Không tìm thấy định mức.", 404);
    return setProcessingRatio(tx, actor, { ...bom, ratio, onlyIfMissing: false });
  });
});
