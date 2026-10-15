"use client";
import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { AdjustmentRowDTO } from "@/server/purchase/adjustment-in";
const BASE = "/purchase/adjustments-in";
export function AdjustmentInTable({ rows, params }: { rows: AdjustmentRowDTO[]; params: ListParams }) { const columns: Column<AdjustmentRowDTO>[] = [{ key: "code", label: "Mã phiếu", sortable: true, primaryOnMobile: true, render: (x) => <span className="font-mono text-xs">{x.code}</span> }, { key: "at", label: "Ngày nhập", sortable: true, render: (x) => formatDate(x.at) }, { key: "lineCount", label: "Số dòng", align: "right", render: (x) => x.lineCount }, { key: "note", label: "Ghi chú", render: (x) => x.note }, { key: "status", label: "Trạng thái", render: (x) => x.isCancelled ? <Badge tone="danger">Đã hủy</Badge> : <Badge tone="success">Hiệu lực</Badge> }]; const actions = (x: AdjustmentRowDTO): RowAction[] => [{ key: "view", label: "Xem", icon: "eye", href: `${BASE}/${x.id}` }]; return <DataTable id="adjustments-in" columns={columns} rows={rows} rowKey={(x) => x.id} rowHref={(x) => `${BASE}/${x.id}`} rowActions={actions} sort={params.sort} buildSortHref={(s) => buildListHref(BASE, params, { sort: s })} />; }
