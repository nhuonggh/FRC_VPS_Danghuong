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
  // Cột/giá trị giống file mẫu nhập (Có/Không, nhãn loại, số dấu phẩy, Trạng thái) để xuất → sửa → nhập lại.
  const show = (f: (typeof section.fields)[number], v: unknown) => (f.type === "checkbox" ? (v ? "Có" : "Không") : f.type === "select" ? (f.options?.find((o) => o.value === v)?.label ?? "") : v == null ? "" : f.type === "number" ? String(v).replace(".", ",") : String(v));
  const columns = [...section.fields.map((f) => ({ header: f.label, key: f.name })), { header: "Trạng thái", key: "isActive" }];
  const buffer = await buildXlsx(section.label, columns, rows.map((r) => ({ ...Object.fromEntries(section.fields.map((f) => [f.name, show(f, r[f.name])])), isActive: r.isActive ? "Đang dùng" : "Đã tắt" })));
  return xlsxResponse(`${section.key}.xlsx`, buffer);
}
