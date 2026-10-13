"use client";

import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { OrderRowDTO } from "@/server/sales/queries";
import { DELIVERY_LABEL, PAYMENT_LABEL } from "@/server/sales/status";

const BASE = "/sales/orders";

export function OrderTable({ rows, params }: { rows: OrderRowDTO[]; params: ListParams }) {
  const columns: Column<OrderRowDTO>[] = [
    { key: "code", label: "Mã đơn", sortable: true, primaryOnMobile: true, render: (o) => <><span className="font-mono text-xs">{o.code}</span>{o.isDraft && <> <Badge tone="warning">Nháp</Badge></>}</> },
    { key: "orderDate", label: "Ngày", sortable: true, render: (o) => formatDate(o.orderDate) },
    { key: "partnerName", label: "Khách hàng", render: (o) => <><strong>{o.partnerName}</strong><span className="block text-xs text-fg-muted">{o.partnerCode}</span></> },
    { key: "createdByName", label: "Người tạo", render: (o) => o.createdByName ?? "—" },
    { key: "lineCount", label: "Số dòng", align: "right", render: (o) => o.lineCount },
    ...(rows.some((o) => o.orderTotal !== undefined)
      ? [{ key: "orderTotal", label: "Phải thu", align: "right" as const, render: (o: OrderRowDTO) => (o.orderTotal === undefined ? null : formatCurrency(o.orderTotal)) }]
      : []),
    ...(rows.some((o) => o.oldDebt !== undefined)
      ? [
          { key: "oldDebt", label: "Nợ cũ", align: "right" as const, render: (o: OrderRowDTO) => (o.oldDebt === undefined ? null : formatCurrency(o.oldDebt)) },
          { key: "totalPayable", label: "Tổng phải trả", align: "right" as const, render: (o: OrderRowDTO) => (o.totalPayable === undefined ? null : <strong>{formatCurrency(o.totalPayable)}</strong>) },
        ]
      : []),
    {
      key: "delivery", label: "Giao hàng",
      render: (o) => <Badge tone={DELIVERY_LABEL[o.deliveryStatus].tone}>{DELIVERY_LABEL[o.deliveryStatus].label}</Badge>,
    },
    { key: "payment", label: "Thanh toán", render: (o) => <Badge tone={PAYMENT_LABEL[o.paymentStatus].tone}>{PAYMENT_LABEL[o.paymentStatus].label}</Badge> },
    {
      key: "expectedDeliveryDate", label: "Ngày giao", sortable: true,
      render: (o) => (
        <>
          {formatDate(o.expectedDeliveryDate)}
          {o.delayDays > 0 && <span className="block text-xs font-medium text-danger">Trễ {o.delayDays} ngày</span>}
        </>
      ),
    },
  ];
  const actions = (o: OrderRowDTO): RowAction[] => [{ key: "view", label: "Xem", icon: "eye", href: `${BASE}/${o.id}` }];
  return (
    <DataTable id="orders" columns={columns} rows={rows} rowKey={(o) => o.id} rowHref={(o) => `${BASE}/${o.id}`} rowActions={actions}
      sort={params.sort} buildSortHref={(sort) => buildListHref(BASE, params, { sort })} />
  );
}
