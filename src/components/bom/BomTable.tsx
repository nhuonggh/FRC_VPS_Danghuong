"use client";

import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { BomListRow } from "@/server/bom";

const BASE = "/production/bom";

export function BomTable({ rows, canManage, params }: { rows: BomListRow[]; canManage: boolean; params: ListParams }) {
  const columns: Column<BomListRow>[] = [
    {
      key: "product", label: "Thành phẩm", primaryOnMobile: true,
      render: (b) => <><strong>{b.productName}</strong><span className="block font-mono text-xs text-fg-muted">{b.productCode}</span></>,
    },
    { key: "processingType", label: "Kiểu gia công", render: (b) => b.processingType },
    {
      key: "current", label: "Phiên bản hiện hành",
      render: (b) => b.current
        ? <>v{b.current.versionNo} · từ {formatDate(b.current.validFrom)}</>
        : <Badge tone="warning">Chưa có hiệu lực</Badge>,
    },
    { key: "lineCount", label: "Số NVL", align: "right", render: (b) => b.current?.lineCount ?? "—" },
    {
      key: "upcoming", label: "Lên lịch",
      render: (b) => b.upcomingFrom ? <Badge tone="info">Từ {formatDate(b.upcomingFrom)}</Badge> : <span className="text-fg-muted">—</span>,
    },
    { key: "versionCount", label: "Số phiên bản", align: "right", render: (b) => b.versionCount },
  ];
  const actions = (b: BomListRow): RowAction[] => [
    { key: "view", label: "Xem", icon: "eye", href: `${BASE}/${b.id}` },
    ...(canManage ? [{ key: "new-version", label: "Tạo phiên bản mới", icon: "pencil" as const, href: `${BASE}/new?from=${b.id}` }] : []),
  ];
  return (
    <DataTable
      id="boms" columns={columns} rows={rows} rowKey={(b) => b.id} rowHref={(b) => `${BASE}/${b.id}`} rowActions={actions}
      sort={params.sort} buildSortHref={(sort) => buildListHref(BASE, params, { sort })}
    />
  );
}
