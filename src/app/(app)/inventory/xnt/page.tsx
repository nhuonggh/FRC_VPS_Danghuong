import Link from "next/link";
import { Printer } from "lucide-react";
import { OperationalStats } from "@/components/ui/OperationalStats";
import { XntTable } from "@/components/inventory/XntTable";
import { EmptyState, ExportButton, ListPageLayout, MultiSelectFilter, PaginationFooter, QuickTimeFilter, SearchBox } from "@/components/ui";
import { buildExportHref, buildListHref, listTimeRange, parseListParams } from "@/lib/query-params";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { xntList, XNT_NO_GROUP } from "@/server/inventory-reports/xnt";
const BASE = "/inventory/xnt";
export default async function XntPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("stock.view");
  // Mặc định hôm nay được đưa vào params để UI, truy vấn và export luôn đồng bộ.
  const raw = await searchParams;
  const parsed = parseListParams(raw, ["group"]), params = listTimeRange(parsed) ? parsed : { ...parsed, timePreset: "today" as const, timeStart: undefined, timeEnd: undefined };
  const range = listTimeRange(params)!;
  const [report, groupRows] = await Promise.all([
    xntList(prisma, actor, { from: range.start, to: range.end, q: params.q, groups: params.filters.group, page: params.page, pageSize: params.pageSize }),
    prisma.productGroup.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const groupOptions = [...groupRows.map((g) => ({ value: String(g.id), label: g.name })), { value: XNT_NO_GROUP, label: "Chưa phân nhóm" }];
  return <ListPageLayout title="Báo cáo xuất nhập tồn" statsClassName="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4" stats={<OperationalStats kind="xnt" data={{ ...report.stats, total: report.total }} values={actor.perms.has("cost.view") ? { ...report.totals } : undefined} />} actions={<div className="flex flex-wrap items-center gap-2"><Link href={buildExportHref(`${BASE}/print`, params)} target="_blank" className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-border px-3 text-sm hover:bg-hover md:min-h-10"><Printer size={16} aria-hidden />In báo cáo</Link><ExportButton href={buildExportHref("/api/inventory/xnt/export", params)} /></div>} filters={<div className="flex flex-wrap items-center gap-2"><SearchBox basePath={BASE} params={params} placeholder="Tìm mã, tên sản phẩm…" /><QuickTimeFilter basePath={BASE} params={params} allowAll={false} /><MultiSelectFilter label="Nhóm hàng" paramKey="group" options={groupOptions} basePath={BASE} params={params} searchable /></div>} footer={<PaginationFooter total={report.total} page={params.page} pageSize={params.pageSize} buildHref={(patch) => buildListHref(BASE, params, patch)} />}>{report.total ? <XntTable rows={report.rows} totals={report.totals} detailQuery={buildExportHref("", params)} /> : <EmptyState kind="no-result" title="Không có sản phẩm phù hợp" />}</ListPageLayout>;
}
