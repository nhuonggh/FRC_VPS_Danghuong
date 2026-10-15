"use client";
import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { LOSS_TYPE_LABEL } from "@/server/stock-adjust/schemas";
import type { LossRowDTO } from "@/server/stock-adjust/service";

const BASE = "/inventory/adjustments";
export function LossAdjustTable({ rows, params }: { rows: LossRowDTO[]; params: ListParams }) {
  const columns: Column<LossRowDTO>[] = [
    { key: "code", label: "Mã phiếu", sortable: true, primaryOnMobile: true, render: (x) => <span className="font-mono text-xs">{x.code}</span> },
    { key: "type", label: "Loại", render: (x) => LOSS_TYPE_LABEL[x.type] },
    { key: "at", label: "Ngày", sortable: true, render: (x) => formatDate(x.at) },
    { key: "lineCount", label: "Số dòng", align: "right", render: (x) => x.lineCount },
    { key: "note", label: "Lý do", render: (x) => x.note },
    { key: "status", label: "Trạng thái", render: (x) => x.isCancelled ? <Badge tone="danger">Đã hủy</Badge> : <Badge tone="success">Hiệu lực</Badge> },
  ];
  const actions = (x: LossRowDTO): RowAction[] => [{ key: "view", label: "Xem", icon: "eye", href: `${BASE}/${x.id}` }];
  return <DataTable id="loss-adjustments" columns={columns} rows={rows} rowKey={(x) => x.id} rowHref={(x) => `${BASE}/${x.id}`} rowActions={actions} sort={params.sort} buildSortHref={(s) => buildListHref(BASE, params, { sort: s })} />;
}
