"use client";
import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatCurrency } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { PartnerKind } from "@/server/partners/codes";
import type { PartnerDTO } from "@/server/partners/queries";
import { KIND_UI } from "./kinds";
export function PartnerTable({ rows, kind, canManage, params }: { rows: PartnerDTO[]; kind: PartnerKind; canManage: boolean; params: ListParams }) {
  const base = KIND_UI[kind].base;
  const columns: Column<PartnerDTO>[] = [
    { key: "code", label: "Mã", sortable: true, render: (p) => <span className="font-mono text-xs">{p.code}</span> },
    { key: "name", label: "Tên", sortable: true, primaryOnMobile: true, render: (p) => p.name },
    { key: "group", label: "Nhóm", render: (p) => p.groupName },
    { key: "phone", label: "Điện thoại", render: (p) => p.phone },
    ...(kind === "customer" ? [{ key: "debtLimit", label: "Hạn mức nợ", align: "right" as const, render: (p: PartnerDTO) => p.allowCredit ? formatCurrency(p.debtLimit) : null }, { key: "owner", label: "Phụ trách", hiddenByDefault: true, render: (p: PartnerDTO) => p.ownerName }] : []),
    { key: "status", label: "Trạng thái", render: (p) => p.isActive ? <Badge tone="success">Đang hoạt động</Badge> : <Badge>Đã tắt</Badge> },
  ];
  const actions = (p: PartnerDTO): RowAction[] => [{ key: "view", label: "Xem", icon: "eye", href: `${base}/${p.id}` }, ...(canManage ? [{ key: "edit", label: "Sửa", icon: "pencil" as const, href: `${base}/${p.id}?edit=profile` }] : [])];
  return <DataTable id={`partners-${kind}`} columns={columns} rows={rows} rowKey={(p) => p.id} rowHref={(p) => `${base}/${p.id}`} rowActions={actions} sort={params.sort} buildSortHref={(sort) => buildListHref(base, params, { sort })} />;
}
