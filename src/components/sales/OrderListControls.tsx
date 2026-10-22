"use client";

import Link from "next/link";
import { MultiSelectFilter, QuickTimeFilter, SearchBox } from "@/components/ui";
import { buildListHref, listTimeRange, type ListParams } from "@/lib/query-params";
import { formatDate, formatNumber } from "@/lib/format";
import { DELIVERY_LABEL, PAYMENT_LABEL } from "@/server/sales/status";
import { activeOrderTab, ORDER_TABS, resetOrderStatusFilters, type OrderTabKey } from "./order-list-config";

const BASE = "/sales/orders";
const STOCK_OPTIONS = [{ value: "posted", label: "Đã xác nhận xuất kho" }, { value: "draft", label: "Nháp — chưa xuất kho" }];
const DELIVERY_OPTIONS = Object.entries(DELIVERY_LABEL).filter(([key]) => key !== "NEW").map(([value, v]) => ({ value, label: v.label }));
const PAYMENT_OPTIONS = Object.entries(PAYMENT_LABEL).map(([value, v]) => ({ value, label: v.label }));

export function OrderListControls({ params, counts, creators, groups, now }: { params: ListParams; counts: Record<OrderTabKey, number>; creators: { value: string; label: string }[]; groups: { value: string | number; label: string }[]; now: Date }) {
  const active = activeOrderTab(params);
  const range = listTimeRange(params, now);
  const count = Object.entries(params.filters).filter(([k, v]) => v.length && !["pending", "late"].includes(k)).length + (params.timePreset ? 1 : 0);
  const filter = (label: string, paramKey: string, options: { value: string; label: string }[], searchable = false) => <MultiSelectFilter label={label} paramKey={paramKey} basePath={BASE} params={params} options={options} searchable={searchable} />;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <SearchBox basePath={BASE} params={params} placeholder="Tìm mã đơn, khách hàng…" className="[&_input]:min-h-11 md:[&_input]:min-h-10" />
      {filter("Nhóm khách hàng", "group", groups.map((g) => ({ value: String(g.value), label: g.label })), true)}
      {filter("Người tạo", "creator", creators, true)}
      {filter("Giao hàng", "delivery", DELIVERY_OPTIONS)}
      {filter("Thanh toán", "payment", PAYMENT_OPTIONS)}
      {filter("Ghi nhận xuất kho", "stock", STOCK_OPTIONS)}
      <QuickTimeFilter basePath={BASE} params={params} now={now} />
    </div>
    {count > 0 && <p className="text-xs text-fg-secondary">Đang áp dụng {count} điều kiện lọc.{range && ` Ngày lập: ${formatDate(range.start)} – ${formatDate(new Date(range.end.getTime() - 1))}.`} <Link href={BASE} className="text-accent">Xóa bộ lọc</Link></p>}
    <nav aria-label="Trạng thái đơn hàng" className="flex overflow-x-auto border-b border-border">{ORDER_TABS.map((tab) => <Link key={tab.key} href={buildListHref(BASE, params, { filters: { ...resetOrderStatusFilters, ...Object.fromEntries(Object.entries(tab.filters as Record<string, readonly string[]>).map(([key, values]) => [key, [...values]])) } })} aria-current={active === tab.key ? "page" : undefined} className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium ${active === tab.key ? "border-accent text-accent" : "border-transparent text-fg-secondary hover:bg-hover"}`}>{tab.label}<span className={`tabular rounded-full px-2 py-1 text-xs ${active === tab.key ? "bg-accent-soft text-accent" : "bg-hover text-fg-secondary"}`}>{formatNumber(counts[tab.key])}</span></Link>)}</nav>
  </div>;
}
