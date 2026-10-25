import { DebtTable } from "@/components/debt/DebtTable";
import { EmptyState, ExportButton, ListPageLayout, MultiSelectFilter, PaginationFooter, QuickTimeFilter, SearchBox, StatCard } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, listTimeRange, parseTimedListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { DEBT_FILTER_KEYS, listDebts } from "@/server/debt/queries";

export const dynamic = "force-dynamic";
const BASE = "/accounting/debts";

export default async function DebtsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("debt.view");
  const params = parseTimedListParams(await searchParams, DEBT_FILTER_KEYS);
  const { rows, total, summary } = await listDebts(prisma, actor, params);
  const ranged = listTimeRange(params) !== null;
  const filtering = Boolean(params.q || params.filters.kind || params.filters.state || ranged);
  return (
    <ListPageLayout
      title="Công nợ tổng hợp"
      actions={<ExportButton href={buildExportHref("/api/debts/export", params)} />}
      stats={
        <>
          <StatCard label="Phải thu" value={Number(summary.receivable)} tone="info" />
          <StatCard label="Phải trả" value={Number(summary.payable)} tone="warning" />
          <StatCard label="CK tích lũy còn" value={Number(summary.discount)} tone="success" />
          <StatCard label="Số đối tác" value={summary.partners} />
        </>
      }
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox basePath={BASE} params={params} placeholder="Tìm mã, tên đối tác…" />
          <QuickTimeFilter basePath={BASE} params={params} />
          <MultiSelectFilter label="Loại" paramKey="kind" basePath={BASE} params={params} options={[{ value: "customer", label: "Khách hàng" }, { value: "supplier", label: "Nhà cung cấp" }]} />
          <MultiSelectFilter label="Chiều nợ" paramKey="state" basePath={BASE} params={params} options={[{ value: "owing", label: "Phải thu" }, { value: "credit", label: "Phải trả" }]} />
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      {total === 0 ? <EmptyState kind={filtering ? "no-result" : "empty"} title={filtering ? "Không có đối tác phù hợp" : "Chưa có công nợ nào"} /> : <DebtTable rows={rows} params={params} ranged={ranged} />}
    </ListPageLayout>
  );
}
