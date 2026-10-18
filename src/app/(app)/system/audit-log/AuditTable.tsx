"use client";

import { Badge, DataTable, type Column } from "@/components/ui";
import { auditActionLabel, auditEntityLabel } from "@/lib/audit-labels";
import { formatDateTime } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";

export interface AuditRow { id: number; at: string; by: string; action: string; entity: string; entityId: string | null }

const columns: Column<AuditRow>[] = [
  { key: "at", label: "Thời gian", sortable: true, render: (r) => <span className="tabular">{formatDateTime(r.at)}</span> },
  { key: "by", label: "Người thao tác", primaryOnMobile: true, render: (r) => <Badge>{r.by}</Badge> },
  { key: "action", label: "Hành động", sortable: true, render: (r) => <Badge tone="info">{auditActionLabel(r.action)}</Badge> },
  { key: "entity", label: "Đối tượng", sortable: true, render: (r) => <Badge>{auditEntityLabel(r.entity)}</Badge> },
  { key: "entityId", label: "Mã", render: (r) => r.entityId },
];

/** Bảng nhật ký: dòng bất biến — thao tác duy nhất là Xem (không Sửa/Xóa/Khóa, không chọn nhiều). */
export function AuditTable({ rows, params }: { rows: AuditRow[]; params: ListParams }) {
  // Mặc định thật của truy vấn là thời gian giảm dần → báo đúng ở header (aria-sort/mũi tên) thay vì "none".
  const sort = params.sort ?? "-at";
  return (
    <DataTable
      id="audit" columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/system/audit-log/${r.id}`}
      rowActions={(r) => [{ key: "view", label: "Xem", icon: "eye", href: `/system/audit-log/${r.id}` }]}
      sort={sort}
      // Vòng sort: tăng → giảm → BỎ (= mặc định -at). Đang ở -at (mặc định/tường minh) mà bấm "Thời gian" thì "bỏ" sẽ không
      // đổi gì → chuyển thẳng sang tăng dần để lần bấm đầu luôn có tác dụng.
      buildSortHref={(s) => buildListHref("/system/audit-log", params, { sort: s === undefined && sort === "-at" ? "at" : s })}
    />
  );
}
