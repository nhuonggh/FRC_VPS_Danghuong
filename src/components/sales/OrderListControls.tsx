"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Check, SlidersHorizontal, X } from "lucide-react";
import { Combobox, filterComboOptions, type ComboOption } from "@/components/ui/Combobox";
import { QuickTimeFilter, SearchBox } from "@/components/ui";
import { TimeRangeEditor } from "@/components/ui/QuickTimeFilter";
import { buildListHref, listTimeRange, type ListParams } from "@/lib/query-params";
import { formatDate, formatNumber } from "@/lib/format";
import { PAGE_SIZES } from "@/lib/pagination";
import { resolveTimeRange } from "@/lib/time-presets";
import { DELIVERY_LABEL, PAYMENT_LABEL } from "@/server/sales/status";
import { activeOrderTab, ORDER_TABS, resetOrderStatusFilters, type OrderTabKey } from "./order-list-config";

function Choices({ label, options, values, onChange }: { label: string; options: { value: string; label: string }[]; values: string[]; onChange: (values: string[]) => void }) {
  return <Dropdown.Root><Dropdown.Trigger className="flex min-h-11 w-full items-center justify-between rounded-sm border border-border bg-canvas px-3 text-sm">{label}<span className="text-fg-secondary">{values.length ? `${values.length} đã chọn` : "Tất cả"}</span></Dropdown.Trigger><Dropdown.Portal><Dropdown.Content className="z-dialog max-h-72 overflow-auto rounded-md border border-border bg-raised p-1 shadow-md">{options.map((o) => <Dropdown.CheckboxItem key={o.value} checked={values.includes(o.value)} onCheckedChange={() => onChange(values.includes(o.value) ? values.filter((v) => v !== o.value) : [...values, o.value])} onSelect={(e) => e.preventDefault()} className="flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover"><span className="w-4">{values.includes(o.value) && <Check size={16} aria-hidden />}</span>{o.label}</Dropdown.CheckboxItem>)}</Dropdown.Content></Dropdown.Portal></Dropdown.Root>;
}

export function OrderListControls({ params, counts, creators, groups, now }: { params: ListParams; counts: Record<OrderTabKey, number>; creators: { value: string; label: string }[]; groups: ComboOption[]; now: Date }) {
  const router = useRouter();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false), [mobile, setMobile] = useState(false), [draft, setDraft] = useState(params), [error, setError] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => { const media = window.matchMedia("(max-width: 767px)"); const update = () => setMobile(media.matches); update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  const active = activeOrderTab(params);
  const range = listTimeRange(params, now);
  const count = Object.entries(params.filters).filter(([k, v]) => v.length && !["pending", "late"].includes(k)).length + (params.timePreset ? 1 : 0);
  const setFilter = (key: string, values: string[]) => setDraft((d) => ({ ...d, filters: { ...d.filters, [key]: values } }));
  function apply() {
    if (draft.timePreset === "custom" && !resolveTimeRange("custom", now, { start: draft.timeStart, end: draft.timeEnd })) { setError("Chọn đủ khoảng ngày hợp lệ."); return; }
    start(() => router.push(buildListHref("/sales/orders", params, { filters: draft.filters, timePreset: draft.timePreset, timeStart: draft.timePreset === "custom" ? draft.timeStart : undefined, timeEnd: draft.timePreset === "custom" ? draft.timeEnd : undefined, pageSize: draft.pageSize })));
    setOpen(false);
  }
  const input = "min-h-11 w-full rounded-sm border border-border bg-canvas px-3 text-sm";
  const field = (label: string, key: string) => <label className="grid gap-1 text-sm">{label}<input maxLength={200} className={input} value={draft.filters[key]?.[0] ?? ""} onChange={(e) => setFilter(key, e.target.value ? [e.target.value] : [])} /></label>;
  const body = <div className="space-y-3">
    <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {field("Mã đơn hàng", "code")}{field("Tên / mã khách hàng", "customer")}
      <Combobox portalContainer={mobile ? container : undefined} overlay={mobile} label="Nhóm khách hàng" value={groups.find((g) => String(g.value) === draft.filters.group?.[0]) ?? null} loadOptions={async (q) => filterComboOptions(groups, q)} onChange={(o) => setFilter("group", o ? [String(o.value)] : [])} placeholder="Tất cả nhóm" />
      <Combobox portalContainer={mobile ? container : undefined} overlay={mobile} label="Người tạo" value={creators.find((g) => String(g.value) === draft.filters.creator?.[0]) ?? null} loadOptions={async (q) => filterComboOptions(creators, q)} onChange={(o) => setFilter("creator", o ? [String(o.value)] : [])} placeholder="Tất cả người tạo" />
      <Choices label="Giao hàng" values={draft.filters.delivery ?? []} onChange={(v) => setFilter("delivery", v)} options={Object.entries(DELIVERY_LABEL).filter(([key]) => key !== "NEW").map(([value, v]) => ({ value, label: v.label }))} />
      <Choices label="Thanh toán" values={draft.filters.payment ?? []} onChange={(v) => setFilter("payment", v)} options={Object.entries(PAYMENT_LABEL).map(([value, v]) => ({ value, label: v.label }))} />
      <label className="grid gap-1 text-sm">Ghi nhận xuất kho<select className={input} value={draft.filters.stock?.[0] ?? ""} onChange={(e) => setFilter("stock", e.target.value ? [e.target.value] : [])}><option value="">Tất cả</option><option value="posted">Đã xác nhận xuất kho</option><option value="draft">Nháp — chưa xuất kho</option></select></label>
      <div className="grid gap-1 text-sm">{mobile ? <TimeRangeEditor value={draft} now={now} onChange={(value) => setDraft({ ...draft, ...value })} /> : <QuickTimeFilter basePath="/sales/orders" params={draft} now={now} onChange={(value) => setDraft({ ...draft, ...value })} />}</div>
      <label className="grid gap-1 text-sm">Bản ghi mỗi trang<select className={input} value={draft.pageSize} onChange={(e) => setDraft({ ...draft, pageSize: Number(e.target.value) })}>{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex justify-end gap-2"><button type="button" onClick={() => { setDraft({ ...params, filters: {}, timePreset: undefined, timeStart: undefined, timeEnd: undefined, q: undefined }); start(() => router.push(buildListHref("/sales/orders", params, { filters: Object.fromEntries(Object.keys(params.filters).map((k) => [k, []])), q: undefined, timePreset: undefined, timeStart: undefined, timeEnd: undefined }))); setOpen(false); }} disabled={pending} className="min-h-11 rounded-sm border border-border px-3 text-sm">Xóa bộ lọc</button><button type="button" disabled={pending} onClick={apply} className="min-h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50">Áp dụng</button></div>
  </div>;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><SearchBox basePath="/sales/orders" params={params} placeholder="Tìm mã đơn, khách hàng…" /><button type="button" aria-expanded={open} onClick={() => { setDraft(params); setError(""); setOpen(!open); }} className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm"><SlidersHorizontal size={16} aria-hidden />Bộ lọc{count > 0 && <span className="tabular rounded-full bg-accent-soft px-2 text-xs text-accent">{count}</span>}</button></div>
    <nav aria-label="Trạng thái đơn hàng" className="flex overflow-x-auto border-b border-border">{ORDER_TABS.map((tab) => <Link key={tab.key} href={buildListHref("/sales/orders", params, { filters: { ...resetOrderStatusFilters, ...Object.fromEntries(Object.entries(tab.filters as Record<string, readonly string[]>).map(([key, values]) => [key, [...values]])) } })} aria-current={active === tab.key ? "page" : undefined} className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium ${active === tab.key ? "border-accent text-accent" : "border-transparent text-fg-secondary hover:bg-hover"}`}>{tab.label}<span className={`tabular rounded-full px-2 py-1 text-xs ${active === tab.key ? "bg-accent-soft text-accent" : "bg-hover text-fg-secondary"}`}>{formatNumber(counts[tab.key])}</span></Link>)}</nav>
    {count > 0 && <p className="text-xs text-fg-secondary">Đang áp dụng {count} điều kiện lọc.{range && ` Ngày lập: ${formatDate(range.start)} – ${formatDate(new Date(range.end.getTime() - 1))}.`} <Link href="/sales/orders" className="text-accent">Xóa bộ lọc</Link></p>}
    {open && !mobile && <section aria-label="Bộ lọc đơn hàng" className="rounded-md border border-border bg-surface p-4">{body}</section>}
    <Dialog.Root open={open && mobile} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" /><Dialog.Content ref={setContainer} className="fixed inset-x-0 bottom-0 z-dialog max-h-[85dvh] overflow-auto rounded-t-lg border border-border bg-raised p-4"><div className="mb-3 flex items-center justify-between"><Dialog.Title className="text-lg font-semibold">Bộ lọc đơn hàng</Dialog.Title><Dialog.Close aria-label="Đóng bộ lọc" className="flex h-11 w-11 items-center justify-center"><X size={20} aria-hidden /></Dialog.Close></div><Dialog.Description className="mb-3 text-sm text-fg-secondary">Chọn điều kiện rồi bấm Áp dụng.</Dialog.Description>{body}</Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
