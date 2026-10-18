"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { Combobox, EmptyState, FormCard, type ComboOption } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { confirmLeaveIfDirty } from "@/lib/dirty-guard";
import { formatDate } from "@/lib/format";
import type { ReturnableOrderDTO } from "@/server/returns/queries";
import { ReturnByOrderForm } from "./ReturnByOrderForm";

export function ReturnByOrderWorkspace({ order, customer, orders, today, refundAccounts, undelivered }: {
  order: ReturnableOrderDTO | null; customer: ComboOption | null;
  orders: { id: number; code: string; partnerName: string; orderDate: Date }[];
  today: string; refundAccounts?: (ComboOption & { type: "CASH" | "BANK" })[]; undelivered: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selectionVersion, resetSelection] = useState(0);
  async function choose(orderId?: string | number, partnerId = customer?.value) {
    if (!(await confirmLeaveIfDirty())) { resetSelection((v) => v + 1); return; }
    const qs = new URLSearchParams();
    if (partnerId) qs.set("partnerId", String(partnerId));
    if (orderId) qs.set("orderId", String(orderId));
    if (undelivered) qs.set("undelivered", "1");
    start(() => router.push(`/returns/by-order/new${qs.size ? `?${qs}` : ""}`));
  }
  const load = (type: string, q: string) => apiFetch<ComboOption[]>(`/api/returns/order-options?type=${type}&q=${encodeURIComponent(q)}${customer ? `&partnerId=${customer.value}` : ""}${undelivered ? "&undelivered=1" : ""}`);
  const selection = <FormCard icon={ClipboardList} title="Chọn khách hàng và đơn hàng"><div className="grid gap-3 md:grid-cols-2">
    <Combobox key={`customer-${selectionVersion}`} label="Khách hàng" value={customer} disabled={pending} loadOptions={(q) => load("customers", q)} onChange={(o) => void choose(undefined, o?.value ?? "")} placeholder="Tìm khách hàng…" />
    <Combobox key={`${customer?.value ?? "all"}-${selectionVersion}`} label="Đơn hàng" value={order ? { value: order.id, label: `${order.code} — ${order.partnerName}` } : null} disabled={pending} loadOptions={(q) => load("orders", q)} onChange={(o) => void choose(o?.value)} placeholder="Tìm mã đơn…" />
  </div>{!order && <ul className="mt-3 divide-y divide-border rounded-sm border border-border">{orders.map((o) => <li key={o.id}><button type="button" disabled={pending} onClick={() => void choose(o.id)} className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 px-3 py-3 text-left text-sm hover:bg-hover disabled:opacity-50"><span><span className="font-medium text-accent">{o.code}</span> · {o.partnerName}</span><span className="text-fg-secondary">{formatDate(o.orderDate)}</span></button></li>)}</ul>}</FormCard>;
  return order ? <ReturnByOrderForm key={`${order.id}-${order.undelivered}`} order={order} today={today} refundAccounts={refundAccounts} selection={selection} /> : <div className="space-y-4"><h1 className="text-xl font-semibold">Trả hàng theo đơn</h1>{selection}<EmptyState kind={orders.length ? "empty" : "no-result"} title={orders.length ? "Chọn đơn để nhập hàng trả" : "Không có đơn phù hợp"} /><p className="rounded-md border border-border bg-surface p-4 text-sm text-fg-secondary">{undelivered ? "Chọn đơn để trả kho phần hàng chưa giao." : "Chỉ hiện đơn đã giao ít nhất một phần. Khách không nhớ đơn: dùng “Trả theo sản phẩm”."} Gõ mã đơn để tìm các đơn khác.</p></div>;
}
