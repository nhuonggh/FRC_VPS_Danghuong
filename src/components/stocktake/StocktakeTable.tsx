"use client";
import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { STOCKTAKE_LABEL, type StocktakeRowDTO } from "./labels";

const BASE = "/inventory/stocktakes";
const TONE = { DRAFT: "warning", DONE: "success", CANCELLED: "danger" } as const;
export function StocktakeTable({ rows, params }: { rows: StocktakeRowDTO[]; params: ListParams }) {
  const columns: Column<StocktakeRowDTO>[] = [
    { key: "code", label: "Mã phiếu", sortable: true, primaryOnMobile: true, render: (x) => <span className="font-mono text-xs">{x.code}</span> },
    { key: "at", label: "Ngày kiểm", sortable: true, render: (x) => formatDate(x.at) },
    { key: "lineCount", label: "Số dòng", align: "right", render: (x) => x.lineCount },
    { key: "note", label: "Ghi chú", render: (x) => x.note },
    { key: "status", label: "Trạng thái", render: (x) => <Badge tone={TONE[x.status]}>{STOCKTAKE_LABEL[x.status]}</Badge> },
  ];
  const actions = (x: StocktakeRowDTO): RowAction[] => [{ key: "view", label: "Xem", icon: "eye", href: `${BASE}/${x.id}` }];
  return <DataTable id="stocktakes" columns={columns} rows={rows} rowKey={(x) => x.id} rowHref={(x) => `${BASE}/${x.id}`} rowActions={actions} sort={params.sort} buildSortHref={(s) => buildListHref(BASE, params, { sort: s })} />;
}
