"use client";

import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { ReturnRowDTO } from "@/server/returns/queries";

export function ReturnTable({ id, base, rows, params }: { id: string; base: string; rows: ReturnRowDTO[]; params: ListParams }) {
  const showOrder = rows.some((r) => r.orderCode);
  const showTotal = rows.some((r) => r.returnTotal !== undefined || r.purchaseTotal !== undefined);
  const columns: Column<ReturnRowDTO>[] = [
    { key: "code", label: "Mã phiếu", sortable: true, primaryOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: "at", label: "Ngày", sortable: true, render: (r) => formatDate(r.at) },
    { key: "partnerName", label: "Đối tác", render: (r) => <><strong>{r.partnerName}</strong><span className="block text-xs text-fg-muted">{r.partnerCode}</span></> },
    ...(showOrder ? [{ key: "orderCode", label: "Đơn gốc", render: (r: ReturnRowDTO) => (r.orderCode ? <span className="font-mono text-xs">{r.orderCode}</span> : null) }] : []),
    { key: "lineCount", label: "Số dòng", align: "right", render: (r) => r.lineCount },
    ...(showTotal ? [{ key: "total", label: "Giá trị", align: "right" as const, render: (r: ReturnRowDTO) => { const v = r.returnTotal ?? r.purchaseTotal; return v === undefined ? null : formatCurrency(v); } }] : []),
    { key: "state", label: "Trạng thái", render: (r) => (r.isCancelled ? <Badge tone="danger">Đã hủy</Badge> : <Badge tone="success">Hiệu lực</Badge>) },
  ];
  const actions = (r: ReturnRowDTO): RowAction[] => [{ key: "view", label: "Xem", icon: "eye", href: `/returns/${r.id}` }];
  return <DataTable id={id} columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/returns/${r.id}`} rowActions={actions} sort={params.sort} buildSortHref={(sort) => buildListHref(base, params, { sort })} />;
}
