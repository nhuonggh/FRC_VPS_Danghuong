import { Plus } from "lucide-react";
import Link from "next/link";
import { Badge, EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, QuickTimeFilter, SearchBox, StatCard } from "@/components/ui";
import { formatCurrency } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { TripRowDTO, TripStatsDTO } from "@/server/trips/queries";
import { TRIP_STATUS_LABEL } from "@/server/trips/schemas";

const TONE = { PLANNED: "info", ON_ROAD: "info", RETURNED: "warning", SETTLED: "warning", CONFIRMED: "success", CANCELLED: "neutral" } as const;

/** Danh sách chuyến (39); dùng chung cho “Nhập kết quả giao” (40) và “Đối soát lái xe” (41) bằng bộ lọc trạng thái cố định. */
export function TripList({ title, base, rows, total, stats, params, vehicles, canCreate, fixedStatus }: {
  title: string; base: string; rows: TripRowDTO[]; total: number; stats: TripStatsDTO; params: ListParams; vehicles: { id: number; name: string }[]; canCreate: boolean; fixedStatus?: boolean;
}) {
  const status = params.filters.status?.[0];
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(base, params, patch);
  const filtered = !!(params.q || params.filters.status || params.filters.vehicle || params.timePreset);
  return (
    <ListPageLayout
      title={title}
      actions={canCreate ? <Link href="/delivery/trips/new" className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden />Xếp chuyến</Link> : undefined}
      stats={fixedStatus ? undefined : <>
        <StatCard label="Đang chạy" value={stats.active} tone="info" href={href({ filters: { status: ["PLANNED", "ON_ROAD"] } })} active={status === "PLANNED"} />
        <StatCard label="Chờ đối soát" value={stats.returned} tone="warning" href={href({ filters: { status: ["RETURNED"] } })} active={status === "RETURNED"} />
        <StatCard label="Chờ thủ quỹ nhận tiền" value={stats.settled} tone="warning" href={href({ filters: { status: ["SETTLED"] } })} active={status === "SETTLED"} />
        <StatCard label="Hoàn tất" value={stats.confirmed} tone="success" href={href({ filters: { status: ["CONFIRMED"] } })} active={status === "CONFIRMED"} />
      </>}
      filters={<div className="flex flex-wrap items-center gap-2">
        <SearchBox basePath={base} params={params} placeholder="Tìm mã chuyến, biển số, lái xe…" />
        {!fixedStatus && <MultiSelectFilter label="Trạng thái" paramKey="status" basePath={base} params={params} options={Object.entries(TRIP_STATUS_LABEL).map(([value, label]) => ({ value, label }))} />}
        <MultiSelectFilter label="Xe" paramKey="vehicle" basePath={base} params={params} options={vehicles.map((v) => ({ value: String(v.id), label: v.name }))} />
        <QuickTimeFilter basePath={base} params={params} />
      </div>}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => href(page)} />}
    >
      {total === 0 ? <EmptyState kind={filtered ? "no-result" : "empty"} title={filtered ? "Không có chuyến phù hợp" : "Chưa có chuyến nào"} /> : (
        <table className="w-full min-w-[920px] text-sm">
          <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Mã</th><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Tuyến</th><th className="px-3 py-2">Xe / lái xe</th><th className="px-3 py-2 text-right">Điểm giao</th><th className="px-3 py-2 text-right">Phải thu</th><th className="px-3 py-2 text-right">Đã thu tiền mặt</th><th className="px-3 py-2 text-right">Đã thu chuyển khoản</th><th className="px-3 py-2">Trạng thái</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs"><Link href={`/delivery/trips/${r.id}`} className="text-accent hover:underline">{r.code}</Link></td>
                <td className="px-3 py-2 whitespace-nowrap">{r.date.split("-").reverse().join("/")}</td><td className="px-3 py-2">{r.routeName}</td>
                <td className="px-3 py-2"><strong>{r.vehiclePlate}</strong><span className="block text-xs text-fg-muted">{r.driverName}{r.assistantName ? ` + ${r.assistantName}` : ""}</span></td>
                <td className="px-3 py-2 text-right tabular">{r.done}/{r.stops}</td><td className="px-3 py-2 text-right tabular">{formatCurrency(r.expected)}</td><td className="px-3 py-2 text-right tabular">{formatCurrency(r.cash)}</td><td className="px-3 py-2 text-right tabular">{formatCurrency(r.transfer)}</td>
                <td className="px-3 py-2"><Badge tone={TONE[r.status]}>{r.statusLabel}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ListPageLayout>
  );
}
