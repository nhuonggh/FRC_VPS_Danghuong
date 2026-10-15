import Link from "next/link";
import { Plus } from "lucide-react";
import { ProductionOrderTable } from "@/components/production/ProductionOrderTable";
import { EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, StatCard } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listProductionOrders } from "@/server/production/queries";

const BASE = "/production/orders";
export default async function ProductionOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("production.manage"), params = parseListParams(await searchParams, ["status"]);
  const result = await listProductionOrders(prisma, actor, params), status = params.filters.status?.[0];
  const href = (p: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, p);
  return (
    <ListPageLayout
      title="Lệnh sản xuất phụ kiện Tôn"
      actions={<Link href={`${BASE}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} />Lập lệnh</Link>}
      stats={<><StatCard label="Tổng" value={result.stats.all} href={href({ filters: { status: [] } })} active={!status} /><StatCard label="Hiệu lực" value={result.stats.active} tone="success" href={href({ filters: { status: ["active"] } })} active={status === "active"} /><StatCard label="Đã hủy" value={result.stats.cancelled} tone="danger" href={href({ filters: { status: ["cancelled"] } })} active={status === "cancelled"} /></>}
      filters={<MultiSelectFilter label="Trạng thái" paramKey="status" basePath={BASE} params={params} options={[{ value: "active", label: "Hiệu lực" }, { value: "cancelled", label: "Đã hủy" }]} />}
      footer={<PaginationFooter total={result.total} page={params.page} pageSize={params.pageSize} buildHref={(p) => href(p)} />}
    >
      {result.total ? <ProductionOrderTable rows={result.rows} params={params} /> : <EmptyState kind="empty" title="Chưa có lệnh sản xuất" action={<Link href={`${BASE}/new`} className="text-sm font-medium text-accent">Lập lệnh đầu tiên</Link>} />}
    </ListPageLayout>
  );
}
