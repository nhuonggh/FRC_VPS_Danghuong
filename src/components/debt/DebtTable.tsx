"use client";

import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatCurrency } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { DebtRowDTO } from "@/server/debt/queries";

const BASE = "/accounting/debts";

export function DebtTable({ rows, params }: { rows: DebtRowDTO[]; params: ListParams }) {
  const columns: Column<DebtRowDTO>[] = [
    { key: "code", label: "Mã", sortable: true, primaryOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: "name", label: "Tên", sortable: true, render: (r) => <><strong>{r.name}</strong><span className="block text-xs text-fg-muted">{r.groupName}</span></> },
    { key: "kind", label: "Loại", render: (r) => [r.isCustomer ? "Khách" : null, r.isSupplier ? "NCC" : null].filter(Boolean).join(" / ") },
    { key: "receivable", label: "Phải thu", align: "right", render: (r) => (Number(r.balance) > 0 ? <span className="font-semibold">{formatCurrency(r.balance)}</span> : null) },
    { key: "payable", label: "Phải trả", align: "right", render: (r) => (Number(r.balance) < 0 ? <span className="font-semibold text-warning">{formatCurrency(String(Math.abs(Number(r.balance))))}</span> : null) },
    { key: "balance", label: "Số dư", align: "right", sortable: true, render: (r) => <span className="tabular">{formatCurrency(r.balance)}</span> },
    { key: "discountBalance", label: "CK tích lũy", align: "right", sortable: true, render: (r) => (Number(r.discountBalance) > 0 ? formatCurrency(r.discountBalance) : null) },
    { key: "limit", label: "Hạn mức", render: (r) => (r.overLimit ? <Badge tone="danger">Vượt hạn mức</Badge> : null) },
  ];
  const actions = (r: DebtRowDTO): RowAction[] => [{ key: "view", label: "Xem chi tiết", icon: "eye", href: `${BASE}/${r.partnerId}` }];
  return (
    <DataTable id="debts" columns={columns} rows={rows} rowKey={(r) => r.partnerId} rowHref={(r) => `${BASE}/${r.partnerId}`} rowActions={actions}
      sort={params.sort} buildSortHref={(sort) => buildListHref(BASE, params, { sort })} />
  );
}
