"use client";

import { Badge, DetailField, DetailPage, useDetailNav } from "@/components/ui";
import { formatCurrency, formatDate, formatDateTime, formatQty } from "@/lib/format";
import type { OrderDetailDTO } from "@/server/sales/queries";
import { DELIVERY_LABEL, PAYMENT_LABEL } from "@/server/sales/status";

const ACTION_LABEL: Record<string, string> = { "sale.create": "Lập đơn" };

export function OrderDetail({ order }: { order: OrderDetailDTO }) {
  const nav = useDetailNav(["info", "lines", "history"]);
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

  return (
    <DetailPage
      backHref="/sales/orders" backLabel="Quay lại danh sách đơn"
      summary={{
        title: order.partnerName, code: order.code,
        badges: [{ label: delivery.label, tone: delivery.tone }, { label: payment.label, tone: payment.tone }, ...(order.delayDays > 0 ? [{ label: `Trễ ${order.delayDays} ngày`, tone: "danger" as const }] : [])],
        facts: [{ label: "Ngày đơn", value: formatDate(order.orderDate) }, { label: "Số dòng", value: order.lines.length }, ...(showPrice ? [{ label: "Phải thu", value: formatCurrency(order.orderTotal!) }] : [])],
      }}
      tabs={[
        { key: "info", label: "Thông tin", render: () => info() },
        { key: "lines", label: "Dòng hàng", count: order.lines.length, render: () => lines() },
        { key: "history", label: "Lịch sử", count: order.history.length, render: () => history() },
      ]}
      {...nav}
    />
  );
}
