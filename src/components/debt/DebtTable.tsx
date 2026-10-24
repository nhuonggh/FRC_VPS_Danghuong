"use client";

import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatCurrency } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { DebtRowDTO } from "@/server/debt/queries";

const BASE = "/accounting/debts";

/** `ranged`: đang lọc khoảng thời gian ⇒ thêm cột Đầu kỳ / Tăng / Giảm của khoảng, và giữ khoảng khi mở chi tiết. */
export function DebtTable({ rows, params, ranged = false }: { rows: DebtRowDTO[]; params: ListParams; ranged?: boolean }) {
  const detail = (r: DebtRowDTO) => {
    const qs = new URLSearchParams();
    if (ranged && params.timePreset) qs.set("timePreset", params.timePreset);
    if (ranged && params.timeStart) qs.set("timeStart", params.timeStart);
    if (ranged && params.timeEnd) qs.set("timeEnd", params.timeEnd);
    return `${BASE}/${r.partnerId}${qs.size ? `?${qs}` : ""}`;
  };
  const columns: Column<DebtRowDTO>[] = [
    { key: "code", label: "Mã", sortable: true, primaryOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: "name", label: "Tên", sortable: true, render: (r) => <><strong>{r.name}</strong><span className="block text-xs text-fg-muted">{r.groupName}</span></> },
    { key: "kind", label: "Loại", render: (r) => [r.isCustomer ? "Khách" : null, r.isSupplier ? "NCC" : null].filter(Boolean).join(" / ") },
    { key: "receivable", label: "Phải thu", align: "right", render: (r) => (Number(r.balance) > 0 ? <span className="font-semibold">{formatCurrency(r.balance)}</span> : null) },
    { key: "payable", label: "Phải trả", align: "right", render: (r) => (Number(r.balance) < 0 ? <span className="font-semibold text-warning">{formatCurrency(String(Math.abs(Number(r.balance))))}</span> : null) },
    ...(ranged ? [
      { key: "opening", label: "Đầu kỳ", align: "right" as const, render: (r: DebtRowDTO) => <span className="tabular">{formatCurrency(r.opening)}</span> },
      { key: "debit", label: "Phát sinh tăng", align: "right" as const, render: (r: DebtRowDTO) => (Number(r.debit) ? <span className="tabular">{formatCurrency(r.debit)}</span> : null) },
      { key: "credit", label: "Phát sinh giảm", align: "right" as const, render: (r: DebtRowDTO) => (Number(r.credit) ? <span className="tabular">{formatCurrency(r.credit)}</span> : null) },
    ] : []),
    { key: "balance", label: ranged ? "Số dư cuối" : "Số dư", align: "right", sortable: true, render: (r) => <span className="tabular">{formatCurrency(r.balance)}</span> },
    { key: "discountBalance", label: "CK tích lũy", align: "right", sortable: true, render: (r) => (Number(r.discountBalance) > 0 ? formatCurrency(r.discountBalance) : Number(r.discountBalance) < 0 ? <span className="text-danger" title="Số dư chiết khấu âm — cần điều chỉnh công nợ">{formatCurrency(r.discountBalance)} ⚠</span> : null) },
    { key: "limit", label: "Hạn mức", render: (r) => (r.overLimit ? <Badge tone="danger">Vượt hạn mức</Badge> : null) },
  ];
  const actions = (r: DebtRowDTO): RowAction[] => [{ key: "view", label: "Xem chi tiết", icon: "eye", href: detail(r) }];
  return (
    <DataTable id="debts" columns={columns} rows={rows} rowKey={(r) => r.partnerId} rowHref={detail} rowActions={actions}
      sort={params.sort} buildSortHref={(sort) => buildListHref(BASE, params, { sort })} />
  );
}
