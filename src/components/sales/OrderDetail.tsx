"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, DetailField, DetailPage, ReasonDialog, useDetailNav } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { formatCurrency, formatDate, formatDateTime, formatQty } from "@/lib/format";
import { pricePerM2 } from "@/lib/length-expr";
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
  const nav = useDetailNav(["info", "lines", "delivery", "deposits", "history"]);
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
  const showCost = order.lines.some((l) => l.unitCostFifo !== undefined);
  const showProfit = order.lines.some((l) => l.lineProfit !== undefined);
  const delivery = DELIVERY_LABEL[order.deliveryStatus], payment = PAYMENT_LABEL[order.paymentStatus];

  const info = () => (
    <dl className="grid gap-x-8 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
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
  const lines = () => (
    <div className="overflow-x-auto rounded-sm border border-border">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
            <th className="px-3 py-2">Sản phẩm</th><th className="px-3 py-2 text-right">SL</th><th className="px-3 py-2">ĐVT</th>
            {showPrice && <><th className="px-3 py-2 text-right">Đơn giá</th><th className="px-3 py-2 text-right">CK trừ ngay</th><th className="px-3 py-2 text-right">CK tích lũy</th><th className="px-3 py-2 text-right">Thành tiền</th></>}
            {showCost && <th className="px-3 py-2 text-right">Giá vốn/ĐV gốc</th>}
            {showProfit && <th className="px-3 py-2 text-right">Lãi dòng</th>}
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.id} className="border-t border-border align-top">
              <td className="px-3 py-2">
                <strong>{l.productName}</strong><span className="block font-mono text-xs text-fg-muted">{l.productCode}</span>
                {l.note && <span className="block text-xs text-fg-secondary">Ghi chú: {l.note}</span>}
                {l.processingType && <span className="block text-xs text-fg-secondary">Gia công: {l.processingType}</span>}
                {l.processingType && l.issues.length > 0 && (
                  <div className="mt-1 text-xs text-fg-secondary">
                    {l.bomVersionLabel && <span className="block">{l.bomVersionLabel}</span>}
                    <ul aria-label={`Nguyên vật liệu đã trừ cho ${l.productCode}`}>
                      {l.issues.map((i) => (
                        <li key={i.productCode}>
                          Trừ {formatQty(i.qtyBase)} {i.baseUnit} {i.productName}
                          {Number(i.qtyProvisional) > 0 && <span className="text-warning"> · thiếu tồn {formatQty(i.qtyProvisional)}</span>}
                          {i.materialCost !== undefined && <span> · vốn {formatCurrency(i.materialCost)}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {l.isProvisional && <Badge tone="warning">Chưa đủ tồn</Badge>}
              </td>
              <td className="px-3 py-2 text-right tabular">{formatQty(l.qty)}{l.areaRatio && <span className="block text-xs text-fg-muted">= {formatQty(Math.round(Number(l.qty) * l.areaRatio * 1000) / 1000)} m²</span>}</td>
              <td className="px-3 py-2">{l.unit}</td>
              {showPrice && <>
                <td className="px-3 py-2 text-right tabular">{l.salePrice !== undefined && (l.areaRatio ? `${formatCurrency(pricePerM2(Number(l.salePrice), l.areaRatio))}/m²` : formatCurrency(l.salePrice))}</td>
                <td className="px-3 py-2 text-right tabular">{l.discountNow !== undefined && formatCurrency(l.discountNow)}</td>
                <td className="px-3 py-2 text-right tabular">{l.discountAccum !== undefined && formatCurrency(l.discountAccum)}</td>
                <td className="px-3 py-2 text-right tabular">{l.lineAmount !== undefined && formatCurrency(l.lineAmount)}</td>
              </>}
              {showCost && <td className="px-3 py-2 text-right tabular">{l.isProvisional ? "—" : l.unitCostFifo !== undefined && formatCurrency(l.unitCostFifo)}</td>}
              {showProfit && <td className="px-3 py-2 text-right tabular">{l.lineProfit == null ? "—" : formatCurrency(l.lineProfit)}</td>}
            </tr>
          ))}
        </tbody>
        {showPrice && (Number(order.shippingFee ?? 0) > 0 || Number(order.orderDiscount ?? 0) > 0) && (
          <tfoot>
            <tr className="border-t-2 border-border text-sm">
              <td colSpan={6} className="px-3 py-2 text-right text-fg-muted">
                Hàng {formatCurrency(order.lines.reduce((s, l) => s + Number(l.lineAmount ?? 0), 0))}
                {Number(order.orderDiscount ?? 0) > 0 && <> · CK cả đơn (đã tính trong CK trừ ngay) {formatCurrency(order.orderDiscount!)}</>}
                {Number(order.shippingFee ?? 0) > 0 && <> · Phí vận chuyển {formatCurrency(order.shippingFee!)}</>}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular">{formatCurrency(order.orderTotal!)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
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
    <div className="space-y-4">
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
      stacked
      tabs={[
        { key: "info", label: "Thông tin cơ bản", render: () => info() },
        { key: "lines", label: "Dòng hàng", count: order.lines.length, render: () => lines() },
        { key: "delivery", label: "Giao hàng", count: order.deliveries.filter((d) => !d.isCancelled).length, render: () => <DeliveryPanel order={order} today={today} canDeliver={perms.canEdit && !order.isDraft} canPrint={!!perms.canPrint} /> },
        { key: "deposits", label: "Thanh toán & tiền cọc", count: order.deposits.length, render: () => <DepositPanel order={order} today={today} canDeposit={perms.canDeposit} /> },
        { key: "history", label: "Lịch sử", count: order.history.length, render: () => history() },
      ]}
      {...nav}
    />
      <ReasonDialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={`Hủy đơn ${order.code}?`}
        description="Hàng được hoàn kho và giá vốn các đơn sau được tính lại. Đơn còn phiếu giao phải hủy phiếu giao trước." confirmLabel="Hủy đơn" onConfirm={cancelOrder} />
    </div>
  );
}
