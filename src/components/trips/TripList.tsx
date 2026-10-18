import { Plus, X } from "lucide-react";
import Link from "next/link";
import { Badge, EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, QuickTimeFilter, SearchBox, StatCard } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { TripRowDTO, TripStatsDTO } from "@/server/trips/queries";
import { TRIP_STATUS_LABEL } from "@/server/trips/schemas";

const TONE = { PLANNED: "info", ON_ROAD: "info", RETURNED: "warning", SETTLED: "warning", CONFIRMED: "success", CANCELLED: "danger" } as const;
const COLLECTION_OPTIONS = [{ value: "paid", label: "Đã thu" }, { value: "unpaid", label: "Chưa thu" }];
function CollectionBadge({ state }: { state: TripRowDTO["collectionStatus"] }) {
  return state ? <Badge tone={state === "paid" ? "success" : "warning"}>{state === "paid" ? "Đã thu" : "Chưa thu"}</Badge> : <span className="text-fg-secondary">—</span>;
}

/** Shared list; fixedStatus pages retain their workflow-specific status constraints. */
export function TripList({ title, base, rows, total, stats, params, vehicles, customers = [], routes = [], canCreate, fixedStatus }: {
  title: string; base: string; rows: TripRowDTO[]; total: number; stats: TripStatsDTO; params: ListParams;
  vehicles: { id: number; name: string }[]; customers?: { id: number; name: string }[]; routes?: { id: number; name: string }[]; canCreate: boolean; fixedStatus?: boolean;
}) {
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(base, params, patch);
  const filtered = !!(params.q || Object.values(params.filters).some((v) => v.length) || params.timePreset);
  const tabs = [{ key: "all", label: "Tất cả", count: stats.all }, ...Object.entries(TRIP_STATUS_LABEL).map(([key, label]) => ({ key, label, count: stats.counts[key as keyof typeof TRIP_STATUS_LABEL] }))];
  const selectedStatus = params.filters.status?.length === 1 ? params.filters.status[0] : params.filters.status?.length ? "multiple" : "all";
  const referenceFilters = [{ key: "customer", label: "Khách hàng", options: customers }, { key: "route", label: "Tuyến", options: routes }];
  const clearFilters = href({ q: undefined, timePreset: undefined, timeStart: undefined, timeEnd: undefined, filters: Object.fromEntries(Object.keys(params.filters).map((key) => [key, []])) });
  return <ListPageLayout title={title}
    statsClassName="grid grid-cols-1 sm:grid-cols-3"
    stats={fixedStatus ? <><StatCard label="Tổng chuyến" value={stats.all} /><StatCard label="Chờ đối soát" value={stats.returned} tone="warning" /><StatCard label="Đã đối soát" value={stats.settled} tone="success" /></> : undefined}
    description={!fixedStatus ? "Theo dõi chuyến giao hàng theo trạng thái và thu tiền" : undefined}
    actions={canCreate ? <Link href="/delivery/trips/new" className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden />Xếp chuyến</Link> : undefined}
    filters={<div className="space-y-3">
      {!fixedStatus && <nav aria-label="Trạng thái chuyến" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {tabs.map((tab) => <StatCard key={tab.key} label={tab.label} value={tab.count}
          tone={tab.key === "all" ? "neutral" : TONE[tab.key as keyof typeof TONE]}
          href={href({ filters: { status: tab.key === "all" ? [] : [tab.key] } })}
          active={selectedStatus === tab.key} />)}
      </nav>}
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox basePath={base} params={params} placeholder="Tìm mã chuyến, biển số, lái xe…" className="[&_input]:min-h-11 md:[&_input]:min-h-10" />
        {!fixedStatus && <>{referenceFilters.map((filter) => <MultiSelectFilter key={filter.key} label={filter.label} paramKey={filter.key} basePath={base} params={params} searchable options={filter.options.map((o) => ({ value: String(o.id), label: o.name }))} />)}
          <MultiSelectFilter label="Trạng thái phải thu" paramKey="collection" basePath={base} params={params} options={COLLECTION_OPTIONS} />
        </>}
        <MultiSelectFilter label="Xe" paramKey="vehicle" basePath={base} params={params} options={vehicles.map((v) => ({ value: String(v.id), label: v.name }))} />
        <QuickTimeFilter basePath={base} params={params} />
      </div>
      {!fixedStatus && <div className="flex flex-wrap items-center gap-2">
        {referenceFilters.flatMap((filter) => (params.filters[filter.key] ?? []).map((value) => <Link key={`${filter.key}-${value}`} href={href({ filters: { [filter.key]: params.filters[filter.key].filter((v) => v !== value) } })} aria-label={`Bỏ lọc ${filter.label.toLocaleLowerCase("vi")}: ${filter.options.find((o) => String(o.id) === value)?.name ?? value}`} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent-soft px-3 text-xs text-accent md:min-h-9">{filter.label}: {filter.options.find((o) => String(o.id) === value)?.name ?? value}<X size={14} aria-hidden /></Link>))}
        {filtered && <Link href={clearFilters} className="inline-flex min-h-11 items-center text-sm text-accent">Xóa bộ lọc</Link>}
        <p className="w-full text-xs text-fg-secondary">Chưa thu gồm thu một phần hoặc điểm giao chưa nhập kết quả. Đã thu tính cả khoản bớt đã được ghi nhận.</p>
      </div>}
    </div>}
    footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => href(page)} />}
  >
    {rows.length === 0 ? <EmptyState kind={filtered ? "no-result" : "empty"} title={filtered ? "Không có chuyến phù hợp" : "Chưa có chuyến nào"} action={filtered ? <Link href={clearFilters} className="text-sm text-accent">Xóa bộ lọc</Link> : undefined} /> : <>
      <div className="hidden overflow-x-auto md:block"><table className="w-full text-sm">
        <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">{["Mã", "Ngày", "Tuyến", "Xe / lái xe", "Điểm giao", "Phải thu", "Đã thu tiền mặt", "Đã thu chuyển khoản", "Trạng thái phải thu", "Trạng thái"].map((label, i) => <th key={label} scope="col" className={`whitespace-nowrap px-3 py-3 ${i >= 4 && i <= 7 ? "text-right" : ""}`}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-border hover:bg-hover">
          <td className="px-3 py-3 font-mono text-xs"><Link href={`/delivery/trips/${r.id}`} className="font-semibold text-accent hover:underline">{r.code}</Link></td>
          <td className="whitespace-nowrap px-3 py-3">{r.date.split("-").reverse().join("/")}</td><td className="px-3 py-3">{r.routeName ?? "—"}</td>
          <td className="px-3 py-3"><strong className="font-medium">{r.vehiclePlate}</strong><span className="block text-xs text-fg-secondary">{r.driverName}{r.assistantName ? ` + ${r.assistantName}` : ""}</span></td>
          <td className="px-3 py-3 text-right tabular-nums">{formatNumber(r.done)}/{formatNumber(r.stops)}</td><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatCurrency(r.expected)}</td><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatCurrency(r.cash)}</td><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatCurrency(r.transfer)}</td>
          <td className="px-3 py-3"><CollectionBadge state={r.collectionStatus} /></td><td className="px-3 py-3"><Badge tone={TONE[r.status]}>{r.statusLabel}</Badge></td>
        </tr>)}</tbody>
      </table></div>
      <ul className="space-y-3 p-3 md:hidden">{rows.map((r) => <li key={r.id} className="rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/delivery/trips/${r.id}`} className="inline-flex min-h-11 items-center font-mono text-sm font-semibold text-accent">{r.code}</Link><Badge tone={TONE[r.status]}>{r.statusLabel}</Badge></div>
        <p className="mt-1 text-sm font-medium">{r.routeName ?? "Chưa có tuyến"} · {r.vehiclePlate}</p><p className="mt-1 text-xs text-fg-secondary">{r.driverName}{r.assistantName ? ` + ${r.assistantName}` : ""} · {r.date.split("-").reverse().join("/")}</p>
        <dl className="mt-3 space-y-2 text-sm">{[{ label: "Điểm giao", value: `${formatNumber(r.done)}/${formatNumber(r.stops)}` }, { label: "Phải thu", value: formatCurrency(r.expected) }, { label: "Đã thu tiền mặt", value: formatCurrency(r.cash) }, { label: "Đã thu chuyển khoản", value: formatCurrency(r.transfer) }].map((field) => <div key={field.label} className="flex justify-between gap-3"><dt className="text-fg-secondary">{field.label}</dt><dd className="text-right tabular-nums">{field.value}</dd></div>)}<div className="flex justify-between gap-3"><dt className="text-fg-secondary">Trạng thái phải thu</dt><dd><CollectionBadge state={r.collectionStatus} /></dd></div></dl>
      </li>)}</ul>
    </>}
  </ListPageLayout>;
}
