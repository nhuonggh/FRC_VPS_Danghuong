import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";
import { setProductUnitsBulk } from "@/server/products/service";

/** Sửa nhanh đơn vị quy đổi + tỷ trọng nhiều sản phẩm (một giao dịch). */
export const PATCH = apiHandler(async (req) => {
  const actor = await requireActorApi("product.manage");
  const { items } = z.object({ items: z.array(z.object({ id: z.number().int().positive(), unit: z.string(), factor: z.string() })).min(1).max(200) }).parse(await readJson(req));
  await prisma.$transaction((tx) => setProductUnitsBulk(tx, actor, items), { timeout: 30_000 });
  return { ok: true, count: items.length };
});
