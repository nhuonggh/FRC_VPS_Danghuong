import { XntTable } from "@/components/inventory/XntTable";
import { EmptyState, ExportButton, ListPageLayout, PaginationFooter, QuickTimeFilter, SearchBox } from "@/components/ui";
import { buildExportHref, buildListHref, listTimeRange, parseListParams } from "@/lib/query-params";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { xntList } from "@/server/inventory-reports/xnt";
const BASE = "/inventory/xnt";
export default async function XntPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("stock.view");
  // Mặc định tháng này được đưa vào params để UI, truy vấn và export luôn đồng bộ.
  const raw = await searchParams;
  const params = parseListParams({ ...raw, timePreset: raw.timePreset ?? "thisMonth" });
  const range = listTimeRange(params)!;
  const report = await xntList(prisma, actor, { from: range.start, to: range.end, q: params.q, page: params.page, pageSize: params.pageSize });
  return <ListPageLayout title="Báo cáo xuất nhập tồn" actions={<ExportButton href={buildExportHref("/api/inventory/xnt/export", params)} />} filters={<div className="flex flex-wrap items-center gap-2"><SearchBox basePath={BASE} params={params} placeholder="Tìm mã, tên sản phẩm…" /><QuickTimeFilter basePath={BASE} params={params} /></div>} footer={<PaginationFooter total={report.total} page={params.page} pageSize={params.pageSize} buildHref={(patch) => buildListHref(BASE, params, patch)} />}>{report.total ? <XntTable rows={report.rows} totals={report.totals} /> : <EmptyState kind="no-result" title="Không có sản phẩm phù hợp" />}</ListPageLayout>;
}
