import { Plus } from "lucide-react";
import Link from "next/link";
import { QuoteTable } from "@/components/sales/QuoteTable";
import { QUOTE_STATUS } from "@/components/sales/quote-status";
import { EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, SearchBox } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listQuotes, QUOTE_FILTER_KEYS } from "@/server/quotes/queries";

export const dynamic = "force-dynamic";
const BASE = "/sales/quotes";

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("quote.manage");
  const params = parseListParams(await searchParams, QUOTE_FILTER_KEYS);
  const { rows, total } = await listQuotes(prisma, actor, params);
  const canCreate = actor.perms.has("sale_price.view");
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
      ) : <QuoteTable rows={rows} params={params} />}
    </ListPageLayout>
  );
}
