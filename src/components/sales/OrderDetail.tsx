"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DetailPage, ReasonDialog, useDetailNav } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { OrderLines } from "./OrderLines";
import type { OrderDetailDTO } from "@/server/sales/queries";
import { SALE_PAYMENT_LABELS } from "@/server/sales/schemas";
import { DELIVERY_LABEL, PAYMENT_LABEL } from "@/server/sales/status";
import { DeliveryPanel } from "./DeliveryPanel";
import { PrintButton } from "@/components/print/PrintButton";
import { DepositPanel } from "./DepositPanel";
import { RestoreButton } from "./RestoreButton";

const ACTION_LABEL: Record<string, string> = {
  "sale.create": "Lập đơn", "sale.update": "Sửa đơn", "sale.cancel": "Hủy đơn", "sale.restore": "Khôi phục đơn",
};

export interface OrderDetailPerms { canEdit: boolean; canCancel: boolean; canRestore: boolean; canConfirm: boolean; canDeleteDraft: boolean; canDeposit: boolean; canReturn: boolean; canPrint?: boolean }

export function OrderDetail({ order, perms, today }: { order: OrderDetailDTO; perms: OrderDetailPerms; today: string }) {
  const router = useRouter();
  const nav = useDetailNav(["all", "info", "lines", "delivery", "deposits", "history"]);
  const [cancelOpen, setCancelOpen] = useState(false);
  async function cancelOrder(reason: string) { await apiFetch(`/api/orders/${order.id}/cancel`, { method: "POST", json: { reason } }); router.refresh(); }
  const [busy, setBusy] = useState(false);
  async function confirmDraft() {
    const ok = await confirm({ title: `Xác nhận đơn ${order.code}?`, description: "Đơn chính thức và hàng được XUẤT KHO ngay theo FIFO. Có thể sửa đơn sau khi xác nhận.", confirmLabel: "Xác nhận đơn" });
    if (!ok || busy) return;
    setBusy(true);
    try { await apiFetch(`/api/orders/${order.id}/confirm`, { method: "POST" }); router.refresh(); } finally { setBusy(false); }
  }
  async function deleteDraft() {
    const ok = await confirm({ title: `Xóa hẳn đơn nháp ${order.code}?`, description: "Đơn nháp bị xóa vĩnh viễn (chưa có kho/công nợ). Báo giá nguồn quay về trạng thái Đã gửi.", confirmLabel: "Xóa nháp", danger: true });
    if (!ok || busy) return;
    setBusy(true);
    try { await apiFetch(`/api/orders/${order.id}`, { method: "DELETE" }); router.push("/sales/orders"); router.refresh(); } finally { setBusy(false); }
  }
  const showPrice = order.orderTotal !== undefined;
  const delivery = DELIVERY_LABEL[order.deliveryStatus], payment = PAYMENT_LABEL[order.paymentStatus];

  const info = () => (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
      <DetailField label="Khách hàng">{order.partnerCode} — {order.partnerName}</DetailField>
      {(order.walkInName || order.walkInPhone) && <DetailField label="Khách lẻ">{[order.walkInName, order.walkInPhone].filter(Boolean).join(" · ")}</DetailField>}
      <DetailField label="Ngày đơn">{formatDate(order.orderDate)}</DetailField>
      <DetailField label="Ngày giao dự kiến">{formatDate(order.expectedDeliveryDate)}</DetailField>
      <DetailField label="Ngày giao ban đầu">{formatDate(order.originalDeliveryDate)}</DetailField>
      <DetailField label="Ghi chú">{order.note}</DetailField>
      <DetailField label="Người lập">{order.createdByName}</DetailField>
      {showPrice && Number(order.orderDiscount ?? 0) > 0 && <DetailField label="Chiết khấu cả đơn">{formatCurrency(order.orderDiscount!)}</DetailField>}
      {showPrice && Number(order.shippingFee ?? 0) > 0 && <DetailField label="Phí vận chuyển">{formatCurrency(order.shippingFee!)}</DetailField>}
      <DetailField label="Nhân viên bán">{order.salesUserName ?? "—"}</DetailField>
      <DetailField label="Kho xuất">{order.warehouseName ?? "—"}</DetailField>
      <DetailField label="Hình thức thanh toán">{SALE_PAYMENT_LABELS[order.paymentMethod]}</DetailField>
      <DetailField label="Báo giá nguồn">{order.quote ? <Link href={`/sales/quotes/${order.quote.id}`} className="text-accent hover:underline">{order.quote.code}</Link> : null}</DetailField>
    </dl>
  );
  const lines = () => <OrderLines order={order} />;
  const history = () => (
    <ul className="divide-y divide-border text-sm">
      {order.history.map((h) => (
        <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2">
          <span>{ACTION_LABEL[h.action] ?? h.action}</span>
          <span className="text-fg-muted">{h.userName ?? "Hệ thống"} · {formatDateTime(h.at)}</span>
        </li>
      ))}
    </ul>
  );

  const live = !order.isCancelled;
  const headerActions = (
    <>
      {order.isCancelled && perms.canRestore && <RestoreButton orderId={order.id} code={order.code} />}
      {live && !order.isDraft && perms.canPrint && <PrintButton docType="SALE_INVOICE" docId={order.id} label="In hóa đơn" />}
      {live && order.isDraft && perms.canConfirm && <button type="button" onClick={confirmDraft} disabled={busy} className="h-10 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50">Xác nhận đơn</button>}
      {live && perms.canEdit && (
        <Link href={`/sales/orders/${order.id}/edit`} className="flex h-10 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover">{order.isDraft ? "Sửa nháp" : "Sửa đơn"}</Link>
      )}
      {live && !order.isDraft && perms.canReturn && (order.deliveryStatus === "PARTIAL" || order.deliveryStatus === "DELIVERED") && (
        <Link href={`/returns/by-order/new?orderId=${order.id}`} className="flex h-10 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover">Trả hàng</Link>
      )}
      {live && order.isDraft && perms.canDeleteDraft && <button type="button" onClick={deleteDraft} disabled={busy} className="h-10 rounded-sm border border-danger px-3 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50">Xóa nháp</button>}
      {live && !order.isDraft && perms.canCancel && (
        <button type="button" onClick={() => setCancelOpen(true)} className="h-10 rounded-sm border border-danger px-3 text-sm font-medium text-danger hover:bg-danger-soft">Hủy đơn</button>
      )}
    </>
  );

  return (
    <div className="order-detail-page space-y-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      {order.isDraft && !order.isCancelled && (
        <div role="status" className="rounded-sm border border-warning bg-warning-soft p-3 text-sm">
          Đơn NHÁP — chưa xuất kho, chưa ghi công nợ. Bấm “Xác nhận đơn” để xuất kho{perms.canConfirm ? "" : " (cần người có quyền lập đơn)"}.
        </div>
      )}
      {order.isCancelled && (
        <div role="status" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">
          Đơn đã hủy{order.cancelReason ? `. Lý do: ${order.cancelReason}` : ""}. {perms.canRestore ? "Bạn có thể khôi phục đơn." : ""}
        </div>
      )}
    <DetailPage
      backHref="/sales/orders" backLabel="Quay lại danh sách đơn" headerActions={headerActions}
      summary={{
        title: order.partnerName, code: order.code,
        badges: order.isCancelled ? [{ label: "Đã hủy", tone: "danger" as const }] : order.isDraft ? [{ label: "Nháp", tone: "warning" as const }] : [{ label: delivery.label, tone: delivery.tone }, { label: payment.label, tone: payment.tone }, ...(order.delayDays > 0 ? [{ label: `Trễ ${order.delayDays} ngày`, tone: "danger" as const }] : [])],
        facts: [{ label: "Ngày đơn", value: formatDate(order.orderDate) }, { label: "Số dòng", value: order.lines.length }, ...(showPrice ? [{ label: "Phải thu", value: formatCurrency(order.orderTotal!) }] : []), ...(Number(order.depositTotal) > 0 ? [{ label: "Đã cọc", value: formatCurrency(order.depositTotal) }] : [])],
      }}
      stacked compact sectionFilter
      tabs={[
        { key: "info", label: "Thông tin cơ bản", render: () => info() },
        { key: "lines", label: "Dòng hàng", count: order.lines.length, render: () => lines() },
        { key: "delivery", label: "Giao hàng", count: order.deliveries.filter((d) => !d.isCancelled).length, render: () => <DeliveryPanel order={order} today={today} canDeliver={perms.canEdit && !order.isDraft} canPrint={!!perms.canPrint} /> },
        { key: "deposits", label: "Thanh toán & tiền cọc", count: order.deposits.length, render: () => <DepositPanel order={order} today={today} canDeposit={perms.canDeposit} /> },
        { key: "history", label: "Lịch sử", count: order.history.length, render: () => history() },
      ]}
      {...nav}
      onTabChange={(key) => router.push(`/sales/orders/${order.id}?tab=${key}`, { scroll: false })}
    />
      <ReasonDialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={`Hủy đơn ${order.code}?`}
        description="Hàng được hoàn kho và giá vốn các đơn sau được tính lại. Đơn còn phiếu giao phải hủy phiếu giao trước." confirmLabel="Hủy đơn" onConfirm={cancelOrder} />
    </div>
  );
}

function DetailField({ label, children }: { label: string; children?: React.ReactNode }) {
  return <div className="min-w-0 space-y-1"><dt className="text-xs text-fg-secondary">{label}</dt><dd className="break-words text-sm font-medium">{children === null || children === undefined || children === "" ? "\u2014" : children}</dd></div>;
}
