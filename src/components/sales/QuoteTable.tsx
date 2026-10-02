"use client";

import { QUOTE_STATUS } from "@/components/sales/quote-status";
import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { QuoteRowDTO } from "@/server/quotes/queries";

const BASE = "/sales/quotes";

/** Client component: page (server) không được truyền hàm render/href sang DataTable — dựng cột ở đây. */
export function QuoteTable({ rows, params }: { rows: QuoteRowDTO[]; params: ListParams }) {
  const columns: Column<QuoteRowDTO>[] = [
    { key: "code", label: "Mã báo giá", sortable: true, primaryOnMobile: true, render: (q) => <span className="font-mono text-xs">{q.code}</span> },
    { key: "at", label: "Ngày", sortable: true, render: (q) => formatDate(q.at) },
    { key: "partnerName", label: "Khách hàng", render: (q) => <><strong>{q.partnerName}</strong><span className="block text-xs text-fg-muted">{q.partnerCode}</span></> },
    { key: "lineCount", label: "Số dòng", align: "right", render: (q) => q.lineCount },
    ...(rows.some((q) => q.quoteTotal !== undefined) ? [{ key: "quoteTotal", label: "Tổng", align: "right" as const, render: (q: QuoteRowDTO) => (q.quoteTotal === undefined ? null : formatCurrency(q.quoteTotal)) }] : []),
    { key: "status", label: "Trạng thái", render: (q) => <Badge tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Badge> },
  ];
  const actions = (q: QuoteRowDTO): RowAction[] => [{ key: "view", label: "Xem", icon: "eye", href: `${BASE}/${q.id}` }];
  return <DataTable id="quotes" columns={columns} rows={rows} rowKey={(q) => q.id} rowHref={(q) => `${BASE}/${q.id}`} rowActions={actions} sort={params.sort} buildSortHref={(sort) => buildListHref(BASE, params, { sort })} />;
}
