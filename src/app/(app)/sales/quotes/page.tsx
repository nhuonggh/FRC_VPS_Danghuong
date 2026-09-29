import { Plus } from "lucide-react";
import Link from "next/link";
import { QUOTE_STATUS } from "@/components/sales/QuoteDetail";
import { Badge, DataTable, EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, SearchBox, type Column, type RowAction } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listQuotes, QUOTE_FILTER_KEYS, type QuoteRowDTO } from "@/server/quotes/queries";

export const dynamic = "force-dynamic";
const BASE = "/sales/quotes";

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("quote.manage");
  const params = parseListParams(await searchParams, QUOTE_FILTER_KEYS);
  const { rows, total } = await listQuotes(prisma, actor, params);
  const canCreate = actor.perms.has("sale_price.view");
  const columns: Column<QuoteRowDTO>[] = [
    { key: "code", label: "Mã báo giá", sortable: true, primaryOnMobile: true, render: (q) => <span className="font-mono text-xs">{q.code}</span> },
    { key: "at", label: "Ngày", sortable: true, render: (q) => formatDate(q.at) },
    { key: "partnerName", label: "Khách hàng", render: (q) => <><strong>{q.partnerName}</strong><span className="block text-xs text-fg-muted">{q.partnerCode}</span></> },
    { key: "lineCount", label: "Số dòng", align: "right", render: (q) => q.lineCount },
    ...(rows.some((q) => q.quoteTotal !== undefined) ? [{ key: "quoteTotal", label: "Tổng", align: "right" as const, render: (q: QuoteRowDTO) => (q.quoteTotal === undefined ? null : formatCurrency(q.quoteTotal)) }] : []),
    { key: "status", label: "Trạng thái", render: (q) => <Badge tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Badge> },
  ];
  const actions = (q: QuoteRowDTO): RowAction[] => [{ key: "view", label: "Xem", icon: "eye", href: `${BASE}/${q.id}` }];
  return (
    <ListPageLayout
      title="Báo giá"
      actions={canCreate ? <Link href={`${BASE}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden />Lập báo giá</Link> : undefined}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox basePath={BASE} params={params} placeholder="Tìm mã báo giá, khách hàng…" />
          <MultiSelectFilter label="Trạng thái" paramKey="status" basePath={BASE} params={params} options={(Object.keys(QUOTE_STATUS) as (keyof typeof QUOTE_STATUS)[]).map((v) => ({ value: v, label: QUOTE_STATUS[v].label }))} />
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      {total === 0 ? (
        <EmptyState kind={params.q || params.filters.status ? "no-result" : "empty"} title={params.q || params.filters.status ? "Không tìm thấy báo giá phù hợp" : "Chưa có báo giá nào"}
          action={canCreate && !params.q ? <Link href={`${BASE}/new`} className="text-sm font-medium text-accent">Lập báo giá đầu tiên</Link> : undefined} />
      ) : <DataTable id="quotes" columns={columns} rows={rows} rowKey={(q) => q.id} rowHref={(q) => `${BASE}/${q.id}`} rowActions={actions} sort={params.sort} buildSortHref={(sort) => buildListHref(BASE, params, { sort })} />}
    </ListPageLayout>
  );
}
