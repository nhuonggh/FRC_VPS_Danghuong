import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { updateCatalogItemsBulk } from "@/server/catalog/service";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";

/** Sửa nhanh nhiều dòng danh mục (Edit Mode): mỗi dòng gửi đủ giá trị các trường như form sửa. */
export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ section: string }> }) => {
  const actor = await requireActorApi("catalog.manage");
  const { section } = await ctx.params;
  const { items } = z.object({ items: z.array(z.object({ id: z.number().int().positive(), values: z.record(z.unknown()) })).min(1).max(200) }).parse(await readJson(req));
  await prisma.$transaction((tx) => updateCatalogItemsBulk(tx, actor, section, items), { timeout: 30_000 });
  return { ok: true, count: items.length };
});
