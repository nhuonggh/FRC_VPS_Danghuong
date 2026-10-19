"use client";
import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatDate, formatQty } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { ProductionRowDTO } from "@/server/production/queries";

const BASE = "/production/orders";
export function ProductionOrderTable({ rows, params }: { rows: ProductionRowDTO[]; params: ListParams }) {
  const columns: Column<ProductionRowDTO>[] = [
    { key: "code", label: "Mã lệnh", sortable: true, primaryOnMobile: true, render: (x) => <span className="font-mono text-xs">{x.code}</span> },
    { key: "at", label: "Ngày", sortable: true, render: (x) => formatDate(x.at) },
    { key: "product", label: "Sản phẩm đầu ra", render: (x) => <>{x.outputs?.length ? x.outputs.map(o => <div key={o.id}><span className="font-mono text-xs">{o.productCode}</span> {o.productName}</div>) : <>{x.productCode} {x.productName}</>}</> },
    { key: "qty", label: "Số lượng", align: "right", render: (x) => <>{x.outputs?.length ? x.outputs.map(o => <div key={o.id} className="tabular">{formatQty(o.qty)} {o.baseUnit}</div>) : `${formatQty(x.qty)} ${x.baseUnit}`}</> },
    { key: "materialCount", label: "Số NVL", align: "right", render: (x) => x.materialCount },
    { key: "status", label: "Trạng thái", render: (x) => x.isCancelled ? <Badge tone="danger">Đã hủy</Badge> : <Badge tone="success">Hiệu lực</Badge> },
  ];
  const actions = (x: ProductionRowDTO): RowAction[] => [{ key: "view", label: "Xem", icon: "eye", href: `${BASE}/${x.id}` }];
  return <DataTable id="production-orders" columns={columns} rows={rows} rowKey={(x) => x.id} rowHref={(x) => `${BASE}/${x.id}`} rowActions={actions} sort={params.sort} buildSortHref={(s) => buildListHref(BASE, params, { sort: s })} />;
}
