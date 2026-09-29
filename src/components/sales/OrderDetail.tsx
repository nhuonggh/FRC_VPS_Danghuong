"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, DetailField, DetailPage, ReasonDialog, useDetailNav } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDate, formatDateTime, formatQty } from "@/lib/format";
import type { OrderDetailDTO } from "@/server/sales/queries";
import { DELIVERY_LABEL, PAYMENT_LABEL } from "@/server/sales/status";
import { DeliveryPanel } from "./DeliveryPanel";
import { RestoreButton } from "./RestoreButton";

const ACTION_LABEL: Record<string, string> = {
  "sale.create": "Lập đơn", "sale.update": "Sửa đơn", "sale.cancel": "Hủy đơn", "sale.restore": "Khôi phục đơn",
};

export interface OrderDetailPerms { canEdit: boolean; canCancel: boolean; canRestore: boolean }

export function OrderDetail({ order, perms, today }: { order: OrderDetailDTO; perms: OrderDetailPerms; today: string }) {
  const router = useRouter();
  const nav = useDetailNav(["info", "lines", "delivery", "history"]);
  const [cancelOpen, setCancelOpen] = useState(false);
  async function cancelOrder(reason: string) { await apiFetch(`/api/orders/${order.id}/cancel`, { method: "POST", json: { reason } }); router.refresh(); }
  const showPrice = order.orderTotal !== undefined;
  const showCost = order.lines.some((l) => l.unitCostFifo !== undefined);
  const showProfit = order.lines.some((l) => l.lineProfit !== undefined);
  const delivery = DELIVERY_LABEL[order.deliveryStatus], payment = PAYMENT_LABEL[order.paymentStatus];

  const info = () => (
    <dl className="space-y-2">
      <DetailField label="Khách hàng">{order.partnerCode} — {order.partnerName}</DetailField>
      <DetailField label="Ngày đơn">{formatDate(order.orderDate)}</DetailField>
      <DetailField label="Ngày giao dự kiến">{formatDate(order.expectedDeliveryDate)}</DetailField>
      <DetailField label="Ngày giao ban đầu">{formatDate(order.originalDeliveryDate)}</DetailField>
      <DetailField label="Ghi chú">{order.note}</DetailField>
      <DetailField label="Người lập">{order.createdByName}</DetailField>
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
                {l.processingType && <span className="block text-xs text-fg-secondary">Gia công: {l.processingType}</span>}
                {l.issues.length > 0 && l.processingType && (
                  <ul className="mt-1 text-xs text-fg-secondary">{l.issues.map((i) => <li key={i.productCode}>Trừ {formatQty(i.qtyBase)} {i.productName}</li>)}</ul>
                )}
                {l.isProvisional && <Badge tone="warning">Chưa đủ tồn</Badge>}
              </td>
              <td className="px-3 py-2 text-right tabular">{formatQty(l.qty)}</td>
              <td className="px-3 py-2">{l.unit}</td>
              {showPrice && <>
                <td className="px-3 py-2 text-right tabular">{l.salePrice !== undefined && formatCurrency(l.salePrice)}</td>
                <td className="px-3 py-2 text-right tabular">{l.discountNow !== undefined && formatCurrency(l.discountNow)}</td>
                <td className="px-3 py-2 text-right tabular">{l.discountAccum !== undefined && formatCurrency(l.discountAccum)}</td>
                <td className="px-3 py-2 text-right tabular">{l.lineAmount !== undefined && formatCurrency(l.lineAmount)}</td>
              </>}
              {showCost && <td className="px-3 py-2 text-right tabular">{l.isProvisional ? "—" : l.unitCostFifo !== undefined && formatCurrency(l.unitCostFifo)}</td>}
              {showProfit && <td className="px-3 py-2 text-right tabular">{l.lineProfit == null ? "—" : formatCurrency(l.lineProfit)}</td>}
            </tr>
          ))}
        </tbody>
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

  const headerActions = (
    <>
      {order.isCancelled && perms.canRestore && <RestoreButton orderId={order.id} code={order.code} />}
      {!order.isCancelled && perms.canEdit && (
        <Link href={`/sales/orders/${order.id}/edit`} className="flex h-10 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover">Sửa đơn</Link>
      )}
      {!order.isCancelled && perms.canCancel && (
        <button type="button" onClick={() => setCancelOpen(true)} className="h-10 rounded-sm border border-danger px-3 text-sm font-medium text-danger hover:bg-danger-soft">Hủy đơn</button>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      {order.isCancelled && (
        <div role="status" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">
          Đơn đã hủy{order.cancelReason ? `. Lý do: ${order.cancelReason}` : ""}. {perms.canRestore ? "Bạn có thể khôi phục đơn." : ""}
        </div>
      )}
    <DetailPage
      backHref="/sales/orders" backLabel="Quay lại danh sách đơn" headerActions={headerActions}
      summary={{
        title: order.partnerName, code: order.code,
        badges: order.isCancelled ? [{ label: "Đã hủy", tone: "danger" as const }] : [{ label: delivery.label, tone: delivery.tone }, { label: payment.label, tone: payment.tone }, ...(order.delayDays > 0 ? [{ label: `Trễ ${order.delayDays} ngày`, tone: "danger" as const }] : [])],
        facts: [{ label: "Ngày đơn", value: formatDate(order.orderDate) }, { label: "Số dòng", value: order.lines.length }, ...(showPrice ? [{ label: "Phải thu", value: formatCurrency(order.orderTotal!) }] : [])],
      }}
      tabs={[
        { key: "info", label: "Thông tin", render: () => info() },
        { key: "lines", label: "Dòng hàng", count: order.lines.length, render: () => lines() },
        { key: "delivery", label: "Giao hàng", count: order.deliveries.filter((d) => !d.isCancelled).length, render: () => <DeliveryPanel order={order} today={today} canDeliver={perms.canEdit} /> },
        { key: "history", label: "Lịch sử", count: order.history.length, render: () => history() },
      ]}
      {...nav}
    />
      <ReasonDialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={`Hủy đơn ${order.code}?`}
        description="Hàng được hoàn kho và giá vốn các đơn sau được tính lại. Đơn còn phiếu giao phải hủy phiếu giao trước." confirmLabel="Hủy đơn" onConfirm={cancelOrder} />
    </div>
  );
}
