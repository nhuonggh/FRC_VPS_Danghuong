"use client";
import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { PurchaseRowDTO } from "@/server/purchase/queries";
const BASE = "/purchase/orders";
export function PurchaseTable({ rows, canEdit, params }: { rows: PurchaseRowDTO[]; canEdit: boolean; params: ListParams }) {
  const columns: Column<PurchaseRowDTO>[] = [
    { key: "code", label: "Mã phiếu", sortable: true, primaryOnMobile: true, render: (p) => <span className="font-mono text-xs">{p.code}</span> },
    { key: "at", label: "Ngày", sortable: true, render: (p) => formatDate(p.at) },
    { key: "partnerName", label: "Nhà cung cấp", render: (p) => <><strong>{p.partnerName}</strong><span className="block text-xs text-fg-muted">{p.partnerCode}</span></> },
    { key: "lineCount", label: "Số dòng", align: "right", render: (p) => p.lineCount },
    ...(rows.some((p) => p.purchaseTotal !== undefined) ? [{ key: "purchaseTotal", label: "Tiền hàng", align: "right" as const, sortable: true, render: (p: PurchaseRowDTO) => p.purchaseTotal ? formatCurrency(p.purchaseTotal) : null }] : []),
    { key: "status", label: "Trạng thái", render: (p) => p.isCancelled ? <Badge tone="danger">Đã hủy</Badge> : <Badge tone="success">Hiệu lực</Badge> },
  ];
  const actions = (p: PurchaseRowDTO): RowAction[] => [{ key: "view", label: "Xem", icon: "eye", href: `${BASE}/${p.id}` }, ...(canEdit && !p.isCancelled ? [{ key: "edit", label: "Sửa", icon: "pencil" as const, href: `${BASE}/${p.id}?edit=content` }] : [])];
  return <DataTable id="purchases" columns={columns} rows={rows} rowKey={(p) => p.id} rowHref={(p) => `${BASE}/${p.id}`} rowActions={actions} sort={params.sort} buildSortHref={(sort) => buildListHref(BASE, params, { sort })} />;
}
