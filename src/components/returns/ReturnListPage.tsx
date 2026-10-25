import { Plus } from "lucide-react";
import Link from "next/link";
import type { ReturnKind } from "@prisma/client";
import { StatCard, EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, QuickTimeFilter, SearchBox } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseTimedListParams } from "@/lib/query-params";
import type { Actor } from "@/lib/permissions/scope";
import { listReturns, RETURN_FILTER_KEYS } from "@/server/returns/queries";
import { ReturnTable } from "./ReturnTable";

/** Danh sách phiếu trả (44/46/48). Trang gọi hàm này với loại tương ứng. */
export async function ReturnListPage({ actor, title, base, kinds, newHref, searchParams }: {
  actor: Actor; title: string; base: string; kinds: ReturnKind[]; newHref: string; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseTimedListParams(await searchParams, RETURN_FILTER_KEYS);
  const { rows, total, stats } = await listReturns(prisma, actor, kinds, params);
  const filtering = Boolean(params.q || params.filters.state || params.timePreset);
  return (
    <ListPageLayout
      title={title}
      statsClassName="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
      stats={<><StatCard label="Tổng phiếu trả" value={total} /><StatCard label="Phiếu hiệu lực" value={stats.active} tone="success" /><StatCard label="Phiếu đã hủy" value={stats.cancelled} />{stats.amount !== undefined && <StatCard label="Giá trị trả hiệu lực" value={stats.amount} money />}</>}
      actions={<Link href={newHref} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden />Lập phiếu trả</Link>}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox basePath={base} params={params} placeholder="Tìm mã phiếu, đơn, đối tác…" />
          <QuickTimeFilter basePath={base} params={params} />
          <MultiSelectFilter label="Trạng thái" paramKey="state" basePath={base} params={params} options={[{ value: "active", label: "Hiệu lực" }, { value: "cancelled", label: "Đã hủy" }]} />
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(base, params, page)} />}
    >
      {total === 0 ? (
        <EmptyState kind={filtering ? "no-result" : "empty"} title={filtering ? "Không tìm thấy phiếu trả phù hợp" : "Chưa có phiếu trả nào"}
          action={!filtering ? <Link href={newHref} className="text-sm font-medium text-accent">Lập phiếu trả đầu tiên</Link> : undefined} />
      ) : <ReturnTable id={`returns-${base.split("/").pop()}`} base={base} rows={rows} params={params} />}
    </ListPageLayout>
  );
}
