import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { deleteBoms } from "@/server/bom";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";

/** Xóa hẳn một hoặc nhiều định mức (chỉ Giám đốc). Có định mức đã dùng trên đơn bán ⇒ 409, không xóa gì. */
export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("bom.delete");
  const { ids } = z.object({ ids: z.array(z.number().int().positive()).min(1, "Chưa chọn định mức nào.").max(500) }).parse(await readJson(req));
  return prisma.$transaction((tx) => deleteBoms(tx, actor, ids), { timeout: 60_000 });
});
