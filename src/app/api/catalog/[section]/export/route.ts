import { getSection } from "@/config/catalog-sections";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { buildXlsx, xlsxResponse } from "@/server/export/xlsx";
import { listCatalogForExport } from "@/server/catalog/queries";

/** Export giữ nguyên q/filter/sort, luôn kiểm quyền tại route độc lập. */
export async function GET(req: Request, ctx: { params: Promise<{ section: string }> }) {
  await requireActorApi("catalog.manage");
  const { section: key } = await ctx.params;
  const section = getSection(key);
  if (!section) return Response.json({ error: "Không tìm thấy mục danh mục." }, { status: 404 });
  const params = parseListParams(Object.fromEntries(new URL(req.url).searchParams), ["status"]);
  const rows = await listCatalogForExport(prisma, key, params);
  const columns = [...section.fields, { name: "isActive", label: "Trạng thái", type: "text" as const }];
  const buffer = await buildXlsx(section.label, columns.map((f) => ({ header: f.label, key: f.name })), rows.map((r) => ({ ...r, isActive: r.isActive ? "Đang dùng" : "Đã tắt" })));
  return xlsxResponse(`${section.key}.xlsx`, buffer);
}
