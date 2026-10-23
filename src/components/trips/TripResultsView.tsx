"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, ClipboardPen, ExternalLink, Plus, X } from "lucide-react";
import { Badge, EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, QuickTimeFilter, SearchBox } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/format";
import { buildListHref, type ListParams, type ListPatch } from "@/lib/query-params";
import { RESULT_STATUS_TONE, RESULT_TRIP_TABS, resultTripLabel } from "@/lib/trip-results";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { TripDetailDTO, TripResultsSummary, TripRowDTO, TripStatsDTO } from "@/server/trips/queries";
import { ResultDialog } from "./TripDetail";
import { TripSettlePanel } from "./TripSettlePanel";

const BASE = "/delivery/results";
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const COLORS = { info: "bg-info", warning: "bg-warning", success: "bg-success", danger: "bg-danger" };
const editable = (status: TripRowDTO["status"]) => status === "PLANNED" || status === "ON_ROAD" || status === "RETURNED";
const resultTone = { GIAO_DU: "success", GHI_NO: "warning", HEN_TRA: "warning", KHONG_GIAO: "danger", GIAO_MOT_PHAN: "info" } as const;

export function TripResultsView({ rows, total, stats, summary, params, vehicles, customers, routes, detail, accounts, closedPeriodName, perms }: {
  perms?: { canSettle: boolean; canConfirm: boolean };
  rows: TripRowDTO[]; total: number; stats: TripStatsDTO; summary: TripResultsSummary; params: ListParams;
  vehicles: { id: number; name: string }[]; customers: { id: number; name: string }[]; routes: { id: number; name: string }[];
  detail: TripDetailDTO | null; accounts: { id: number; name: string; type: "CASH" | "BANK" }[]; closedPeriodName?: string;
}) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const tab = RESULT_TRIP_TABS.find((t) => t.key === params.filters.resultState?.[0]) ?? RESULT_TRIP_TABS[0];
  const collection = params.filters.collection?.length === 1 ? params.filters.collection[0] : "all";
  const href = (patch: ListPatch = {}) => buildListHref(BASE, params, { ...patch, filters: { detail: [], entry: [], ...patch.filters } });
  const expandHref = (id: number) => href({ filters: { detail: detail?.id === id ? [] : [String(id)] }, page: params.page });
  const entryHref = (id: number, stop = "first") => href({ filters: { detail: [String(id)], entry: [stop] }, page: params.page });
  const closeEntry = () => router.replace(buildListHref(BASE, params, { filters: { entry: [] }, page: params.page }), { scroll: false });
  const entry = params.filters.entry?.[0];
  const stop = detail && editable(detail.status) && !closedPeriodName && entry ? entry === "first" ? detail.stops.find((s) => s.result === null) ?? detail.stops[0] : detail.stops.find((s) => String(s.id) === entry) : undefined;
  const filterOptions = [{ key: "customer", label: "Khách hàng", options: customers }, { key: "route", label: "Tuyến", options: [...routes, { id: "none", name: "Chưa gán tuyến" }] }, { key: "vehicle", label: "Xe", options: vehicles }];
  const filtered = !!(params.q || params.timePreset || ["customer", "route", "vehicle", "collection", "resultState"].some((key) => params.filters[key]?.length));
  const clearHref = href({ q: undefined, timePreset: undefined, timeStart: undefined, timeEnd: undefined, filters: Object.fromEntries(Object.keys(params.filters).map((key) => [key, []])) });
  const showStopActions = detail && editable(detail.status) && !closedPeriodName;
  function collectionBadge(row: TripRowDTO) {
    return row.collectionStatus ? <Badge tone={row.collectionStatus === "paid" ? "success" : "warning"}>{row.collectionStatus === "paid" ? "Đã thu" : "Chờ thu"}</Badge> : <span className="text-fg-secondary">—</span>;
  }
  function actions(row: TripRowDTO) {
    const canEdit = editable(row.status) && !(detail?.id === row.id && closedPeriodName);
    const hasAllResults = row.stops > 0 && row.done === row.stops;
    return row.status === "CANCELLED" ? null : <Link href={canEdit ? entryHref(row.id) : `/delivery/trips/${row.id}`} scroll={false}
      aria-label={`${canEdit ? hasAllResults ? "Sửa kết quả" : "Nhập kết quả" : "Xem chuyến"} ${row.code}`} title={canEdit ? hasAllResults ? "Nhập / sửa kết quả" : "Nhập kết quả" : "Đã khóa kết quả · xem chuyến"}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-border text-accent hover:bg-accent-soft md:min-h-9 md:min-w-9 ${focus}`}>
      {canEdit ? <ClipboardPen size={16} aria-hidden /> : <ExternalLink size={16} aria-hidden />}
    </Link>;
  }
  function stopDetails(mobile = false) {
    if (!detail) return null;
    const cell = "px-3 py-3 text-sm";
    return <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Điểm giao · {detail.code}</p><Link href={`/delivery/trips/${detail.id}`} className={`inline-flex min-h-11 items-center gap-1 text-xs text-accent ${focus}`}>Chi tiết chuyến<ExternalLink size={14} aria-hidden /></Link></div>
      {closedPeriodName && <p role="status" className="text-sm text-warning">Kỳ {closedPeriodName} đã đóng, kết quả chỉ được xem.</p>}
      {!editable(detail.status) && detail.status !== "CANCELLED" && <p className="text-xs text-fg-secondary">Chuyến đã đối soát / xác nhận nhận tiền, kết quả được khóa.</p>}
      {mobile ? <ul className="space-y-2">{detail.stops.map((s) => <li key={s.id} className={`space-y-2 rounded-sm border border-border p-3 ${params.filters.customer?.includes(String(s.partnerId)) ? "bg-accent-soft" : "bg-surface"}`}>
        <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{s.partnerName}</span><Badge tone={s.result ? resultTone[s.result] : "info"}>{s.resultLabel ?? "Chờ giao"}</Badge></div>
        <p className="font-mono text-xs text-fg-secondary">{s.orderCode}</p><dl className="space-y-1 text-sm">{[{ label: "Phải thu", value: s.due }, { label: "Tiền mặt", value: s.result ? s.cash : null }, { label: "Chuyển khoản", value: s.result ? s.transfer : null }].map((field) => <div key={field.label} className="flex justify-between gap-3"><dt className="text-fg-secondary">{field.label}</dt><dd className="tabular-nums">{formatCurrency(field.value)}</dd></div>)}</dl>
        {showStopActions && <Link href={entryHref(detail.id, String(s.id))} scroll={false} className={`inline-flex min-h-11 items-center gap-2 text-sm text-accent ${focus}`}><ClipboardPen size={16} aria-hidden />{s.result ? "Sửa kết quả" : "Nhập kết quả"} {s.orderCode}</Link>}
      </li>)}</ul> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-fg-secondary"><tr><th scope="col" className={cell}>Khách hàng / đơn</th><th scope="col" className={cell}>Kết quả giao</th><th scope="col" className={`${cell} text-right`}>Phải thu</th><th scope="col" className={`${cell} text-right`}>Tiền mặt</th><th scope="col" className={`${cell} text-right`}>Chuyển khoản</th><th scope="col"><span className="sr-only">Thao tác điểm giao</span></th></tr></thead><tbody>{detail.stops.map((s) => <tr key={s.id} className={`border-t border-border ${params.filters.customer?.includes(String(s.partnerId)) ? "bg-accent-soft" : ""}`}>
        <td className={cell}><span className="font-medium">{s.partnerName}</span><span className="block font-mono text-xs text-fg-secondary">{s.orderCode}</span></td><td className={cell}><Badge tone={s.result ? resultTone[s.result] : "info"}>{s.resultLabel ?? "Chờ giao"}</Badge></td>
        <td className={`${cell} text-right tabular-nums`}>{formatCurrency(s.due)}</td><td className={`${cell} text-right tabular-nums`}>{formatCurrency(s.result ? s.cash : null)}</td><td className={`${cell} text-right tabular-nums`}>{formatCurrency(s.result ? s.transfer : null)}</td>
        <td className={`${cell} text-right`}>{showStopActions && <Link href={entryHref(detail.id, String(s.id))} scroll={false} title={s.result ? "Sửa kết quả" : "Nhập kết quả"} aria-label={`${s.result ? "Sửa kết quả" : "Nhập kết quả"} ${s.orderCode}`} className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-border text-accent hover:bg-accent-soft md:min-h-9 md:min-w-9 ${focus}`}><ClipboardPen size={16} aria-hidden /></Link>}</td>
      </tr>)}</tbody></table></div>}
      {!closedPeriodName && perms && <TripSettlePanel trip={detail} accounts={accounts} canSettle={perms.canSettle} canConfirm={perms.canConfirm} />}
    </div>;
  }
  return <>
    <ListPageLayout title="Nhập kết quả giao"
      actions={<Link href="/delivery/trips/new" className={`inline-flex min-h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent ${focus}`}><Plus size={16} aria-hidden />Xếp chuyến</Link>}
      statsClassName="grid grid-cols-2 lg:grid-cols-4"
      stats={<>
        <div className="min-w-0 space-y-1 rounded-md border border-border bg-surface p-4"><p className="text-sm text-fg-secondary">Tổng số chuyến</p><strong className="block text-2xl tabular-nums">{formatNumber(summary.total)}</strong><div aria-hidden className="flex h-2 overflow-hidden rounded-full bg-hover">{RESULT_TRIP_TABS.slice(1).map((t) => <span key={t.key} className={COLORS[t.tone]} style={{ width: `${summary.total ? t.statuses.reduce((n, s) => n + summary.counts[s], 0) / summary.total * 100 : 0}%` }} />)}</div><p className="text-xs text-fg-secondary">{formatNumber(summary.counts.ON_ROAD)} đang giao · {formatNumber(summary.counts.PLANNED)} đã xếp</p></div>
        <div className="min-w-0 space-y-1 rounded-md border border-border bg-surface p-4"><p className="text-sm text-fg-secondary">Điểm giao hoàn tất</p><strong className="block text-2xl tabular-nums">{formatNumber(summary.completed)} <span className="text-sm font-medium text-fg-secondary">/ {formatNumber(summary.stops)}</span></strong><div role="progressbar" aria-label="Điểm giao hoàn tất" aria-valuemin={0} aria-valuemax={summary.stops || 1} aria-valuenow={summary.completed} className="h-2 overflow-hidden rounded-full bg-hover"><div className="h-full bg-accent" style={{ width: `${summary.stops ? summary.completed / summary.stops * 100 : 0}%` }} /></div><p className="text-xs text-fg-secondary">{formatNumber(summary.stops - summary.completed)} điểm chưa giao đủ</p></div>
        {[{ key: "unpaid", label: "Chờ thu", value: summary.outstanding, count: summary.unpaidTrips, color: "text-warning", active: "border-warning bg-warning-soft", top: "border-t-warning" }, { key: "paid", label: "Đã thu", value: summary.collected, count: summary.paidTrips, color: "text-success", active: "border-success bg-success-soft", top: "border-t-success" }].map((card) => <Link key={card.key} href={href({ filters: { collection: collection === card.key ? [] : [card.key] } })} aria-current={collection === card.key ? "true" : undefined} className={`min-w-0 space-y-1 rounded-md border border-t-4 p-4 ${focus} ${collection === card.key ? card.active : `border-border bg-surface hover:bg-hover ${card.top}`}`}><p className="text-sm text-fg-secondary">{card.label}</p><strong className={`block text-xl tabular-nums ${card.color}`}>{formatCurrency(card.value)}</strong><p className="text-xs text-fg-secondary">{formatNumber(card.count)} {card.key === "paid" ? "chuyến thu đủ" : "chuyến"}</p></Link>)}
      </>}
      footer={<><div className="flex flex-wrap justify-end gap-4 border-t border-border bg-surface px-4 py-3 text-sm text-fg-secondary"><span>Phải thu <strong className="text-fg tabular-nums">{formatCurrency(summary.filteredExpected)}</strong></span><span>Đã thu <strong className="text-success tabular-nums">{formatCurrency(summary.filteredCollected)}</strong></span></div><PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(patch) => href(patch)} /></>}
    >
      <nav aria-label="Trạng thái kết quả giao" className="flex overflow-x-auto border-b border-border px-3">{RESULT_TRIP_TABS.map((t) => {
        const count = t.key === "all" ? stats.all : t.statuses.reduce((n, s) => n + stats.counts[s], 0);
        return <Link key={t.key} href={href({ filters: { resultState: t.key === "all" ? [] : [t.key] } })} aria-current={tab.key === t.key ? "page" : undefined} className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm ${focus} ${tab.key === t.key ? "border-accent font-semibold text-accent" : "border-transparent text-fg-secondary hover:bg-hover"}`}><span aria-hidden className={`h-2 w-2 rounded-full ${COLORS[t.tone]}`} />{t.label}{" "}<span className="rounded-full bg-hover px-2 text-xs tabular-nums">{formatNumber(count)}</span></Link>;
      })}</nav>
      <div className="space-y-3 border-b border-border p-4"><div className="flex flex-wrap items-center gap-2"><SearchBox basePath={BASE} params={params} placeholder="Tìm mã chuyến, biển số, lái xe…" className="sm:w-64 [&_input]:min-h-11" />{filterOptions.map((filter) => <MultiSelectFilter key={filter.key} label={filter.label} paramKey={filter.key} options={filter.options.map((o) => ({ value: String(o.id), label: o.name }))} basePath={BASE} params={params} searchable />)}<QuickTimeFilter basePath={BASE} params={params} />
        <nav aria-label="Kết quả thu" className="flex overflow-hidden rounded-sm border border-border bg-surface md:ml-auto">{[{ key: "all", label: "Tất cả", count: summary.tabAllTrips }, { key: "unpaid", label: "Chờ thu", count: summary.tabUnpaidTrips }, { key: "paid", label: "Đã thu", count: summary.tabPaidTrips }].map((item) => <Link key={item.key} href={href({ filters: { collection: item.key === "all" ? [] : [item.key] } })} aria-current={collection === item.key ? "page" : undefined} className={`inline-flex min-h-11 shrink-0 items-center gap-1 border-r border-border px-3 text-sm last:border-0 ${focus} ${collection === item.key ? "bg-accent-soft font-medium text-accent" : "text-fg-secondary hover:bg-hover"}`}>{item.label}{" "}<span className="tabular-nums">{formatNumber(item.count)}</span></Link>)}</nav>
      </div>
      <div className="flex flex-wrap items-center gap-2">{filterOptions.flatMap((filter) => (params.filters[filter.key] ?? []).map((value) => <Link key={`${filter.key}-${value}`} href={href({ filters: { [filter.key]: params.filters[filter.key].filter((v) => v !== value) } })} aria-label={`Bỏ lọc ${filter.label}: ${filter.options.find((o) => String(o.id) === value)?.name ?? value}`} className={`inline-flex min-h-11 items-center gap-2 rounded-full bg-accent-soft px-3 text-xs text-accent md:min-h-9 ${focus}`}>{filter.label}: {filter.options.find((o) => String(o.id) === value)?.name ?? value}<X size={14} aria-hidden /></Link>))}{filtered && <Link href={clearHref} className={`inline-flex min-h-11 items-center text-sm text-accent ${focus}`}>Xóa bộ lọc</Link>}</div>
      <p className="text-xs text-fg-secondary">Phải thu và chờ thu chỉ tính số tiền đã ghi nhận khi nhập kết quả; {formatNumber(summary.pending)} điểm chưa nhập chưa được cộng tiền. Chuyến hủy không tính vào tổng tiền.</p></div>
      {rows.length === 0 ? <EmptyState kind={filtered ? "no-result" : "empty"} title="Không có chuyến phù hợp" description="Thử đổi trạng thái, tuyến, khách hàng hoặc khoảng thời gian." /> : <>
        <div className="hidden overflow-x-auto md:block"><table className="w-full text-sm"><thead className="bg-hover text-left text-xs text-fg-secondary"><tr>{["Mã", "Ngày", "Tuyến", "Xe / lái xe", "Điểm giao", "Phải thu", "Đã thu", "Kết quả thu", "Trạng thái", "Thao tác"].map((label, i) => <th key={label} scope="col" className={`whitespace-nowrap px-3 py-3 ${i >= 4 && i <= 6 ? "text-right" : ""}`}>{label}</th>)}</tr></thead><tbody>{rows.map((row) => <Fragment key={row.id}>
          <tr className={`border-t border-border ${detail?.id === row.id ? "bg-accent-soft" : "hover:bg-hover"} ${row.status === "CANCELLED" ? "text-fg-secondary" : ""}`}>
            <td className="px-3 py-3"><Link href={expandHref(row.id)} aria-label={`Xem điểm giao ${row.code}`} aria-expanded={detail?.id === row.id} scroll={false} className={`inline-flex min-h-11 items-center gap-1 font-mono text-xs font-semibold text-accent ${focus}`}><ChevronRight size={16} aria-hidden className={detail?.id === row.id ? "rotate-90" : undefined} />{row.code}</Link></td>
            <td className="whitespace-nowrap px-3 py-3">{row.date.split("-").reverse().join("/")}</td><td className="px-3 py-3">{row.routeName ?? "—"}</td><td className="px-3 py-3"><strong>{row.vehiclePlate}</strong><span className="block text-xs text-fg-secondary">{row.driverName}</span></td>
            <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.done)}/{formatNumber(row.stops)}</td><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{row.status === "CANCELLED" ? "—" : formatCurrency(row.expected)}</td><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums"><strong>{row.status === "CANCELLED" ? "—" : formatCurrency(row.collected)}</strong><span className="block text-xs text-fg-secondary">TM {formatCurrency(row.cash)} · CK {formatCurrency(row.transfer)}</span></td><td className="px-3 py-3">{collectionBadge(row)}</td><td className="px-3 py-3"><Badge tone={RESULT_STATUS_TONE[row.status]}>{resultTripLabel(row.status)}</Badge></td><td className="px-3 py-3 text-right">{actions(row)}</td>
          </tr>{detail?.id === row.id && <tr><td colSpan={10} className="border-t border-dashed border-border bg-canvas p-4">{stopDetails()}</td></tr>}
        </Fragment>)}</tbody></table></div>
        <ul className="space-y-3 p-3 md:hidden">{rows.map((row) => <li key={row.id} className="space-y-3 rounded-md border border-border bg-surface p-4"><div className="flex flex-wrap items-center justify-between gap-2"><Link href={expandHref(row.id)} aria-expanded={detail?.id === row.id} aria-label={`Xem điểm giao ${row.code}`} scroll={false} className={`inline-flex min-h-11 items-center gap-1 font-mono text-sm font-semibold text-accent ${focus}`}><ChevronRight size={16} aria-hidden className={detail?.id === row.id ? "rotate-90" : undefined} />{row.code}</Link><Badge tone={RESULT_STATUS_TONE[row.status]}>{resultTripLabel(row.status)}</Badge></div><p className="text-sm font-medium">{row.routeName ?? "Chưa có tuyến"} · {row.vehiclePlate}</p><p className="text-xs text-fg-secondary">{row.driverName} · {row.date.split("-").reverse().join("/")}</p><dl className="space-y-2 text-sm">{[{ label: "Điểm giao", value: `${row.done}/${row.stops}` }, { label: "Phải thu", value: row.status === "CANCELLED" ? "—" : formatCurrency(row.expected) }, { label: "Đã thu", value: row.status === "CANCELLED" ? "—" : formatCurrency(row.collected) }].map((field) => <div key={field.label} className="flex justify-between gap-3"><dt className="text-fg-secondary">{field.label}</dt><dd className="tabular-nums">{field.value}</dd></div>)}</dl><div className="flex items-center justify-between gap-3">{collectionBadge(row)}{actions(row)}</div>{detail?.id === row.id && <div className="border-t border-dashed border-border pt-3">{stopDetails(true)}</div>}</li>)}</ul>
      </>}
    </ListPageLayout>
    {stop && detail && <ResultDialog key={`${detail.id}-${stop.id}`} stop={stop} tripId={detail.id} accounts={accounts} onClose={closeEntry} onDone={() => idem.reset()} idemKey={idem.key} />}
  </>;
}
