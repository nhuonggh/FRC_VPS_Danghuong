import Link from "next/link";
import { Plus } from "lucide-react";
import { StocktakeTable } from "@/components/stocktake/StocktakeTable";
import { EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, StatCard } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listStocktakes } from "@/server/stocktake/queries";

const BASE = "/inventory/stocktakes";
export default async function StocktakesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("stocktake.manage"), params = parseListParams(await searchParams, ["status"]);
  const result = await listStocktakes(prisma, actor, params), status = params.filters.status?.[0];
  const href = (p: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, p);
  return (
    <ListPageLayout
      title="Kiểm kho"
      actions={<Link href={`${BASE}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} />Lập phiếu</Link>}
      stats={<><StatCard label="Tổng" value={result.stats.all} href={href({ filters: { status: [] } })} active={!status} /><StatCard label="Nháp" value={result.stats.draft} tone="warning" href={href({ filters: { status: ["DRAFT"] } })} active={status === "DRAFT"} /><StatCard label="Đã chốt" value={result.stats.done} tone="success" href={href({ filters: { status: ["DONE"] } })} active={status === "DONE"} /><StatCard label="Đã hủy" value={result.stats.cancelled} tone="danger" href={href({ filters: { status: ["CANCELLED"] } })} active={status === "CANCELLED"} /></>}
      filters={<MultiSelectFilter label="Trạng thái" paramKey="status" basePath={BASE} params={params} options={[{ value: "DRAFT", label: "Nháp" }, { value: "DONE", label: "Đã chốt" }, { value: "CANCELLED", label: "Đã hủy" }]} />}
      footer={<PaginationFooter total={result.total} page={params.page} pageSize={params.pageSize} buildHref={(p) => href(p)} />}
    >
      {result.total ? <StocktakeTable rows={result.rows} params={params} /> : <EmptyState kind="empty" title="Chưa có phiếu kiểm kho" action={<Link href={`${BASE}/new`} className="text-sm font-medium text-accent">Lập phiếu đầu tiên</Link>} />}
    </ListPageLayout>
  );
}
