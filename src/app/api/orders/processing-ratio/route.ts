import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { setProcessingRatio } from "@/server/bom/service";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";

/** Người bán khai báo tỷ lệ m²/md lần đầu cho (sản phẩm × kiểu gia công); đã có thì giữ nguyên, chỉ sửa ở Định mức. */
export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("order.create");
  const b = z.object({ productId: z.number().int().positive(), processingTypeId: z.number().int().positive(), ratio: z.number() }).parse(await readJson(req));
  return prisma.$transaction((tx) => setProcessingRatio(tx, actor, { ...b, onlyIfMissing: true }));
});
