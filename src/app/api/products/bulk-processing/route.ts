import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { bulkSetProcessingLinks } from "@/server/bom/service";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";
import { PRODUCT_FILTER_KEYS } from "@/server/products/queries";

/** Gắn / bỏ một kiểu gia công cho nhiều sản phẩm: `ids` (đã tick) hoặc `filter` (query string của danh sách = "chọn tất cả kết quả"). */
export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("product.view");
  const b = z.object({
    action: z.enum(["link", "unlink"]),
    processingTypeId: z.number().int().positive(),
    ratio: z.number().nullable().default(null),
    ids: z.array(z.number().int().positive()).max(5000).optional(),
    filter: z.string().max(2000).optional(),
  }).refine((v) => v.ids || v.filter !== undefined, "Chưa chọn sản phẩm nào.").parse(await readJson(req));
  let filter;
  if (!b.ids) { const sp: Record<string, string[]> = {}; for (const [k, v] of new URLSearchParams(b.filter)) (sp[k] ??= []).push(v); filter = parseListParams(sp, PRODUCT_FILTER_KEYS); }
  return prisma.$transaction((tx) => bulkSetProcessingLinks(tx, actor, { action: b.action, processingTypeId: b.processingTypeId, ratio: b.ratio, ...(b.ids ? { ids: b.ids } : { filter: filter! }) }), { timeout: 60_000 });
});
