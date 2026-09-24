"use client";

import Link from "next/link";
import { Badge, DataTable, type Column } from "@/components/ui";
import { formatNumber } from "@/lib/format";

interface Row { id: number; name: string; description: string | null; isSystem: boolean; userCount: number; permissionCount: number }

export function RolesTable({ rows, canViewUsers }: { rows: Row[]; canViewUsers: boolean }) {
  const columns: Column<Row>[] = [
    { key: "name", label: "Tên nhóm", primaryOnMobile: true, render: (r) => r.name },
    { key: "description", label: "Mô tả", render: (r) => r.description },
    {
      key: "userCount", label: "Người dùng", align: "right",
      render: (r) => (canViewUsers && r.userCount > 0
        ? <Link href={`/system/users?role=${r.id}`} className="font-medium text-accent hover:underline">{formatNumber(r.userCount)}</Link>
        : formatNumber(r.userCount)),
    },
    { key: "permissionCount", label: "Số quyền", align: "right", render: (r) => formatNumber(r.permissionCount) },
    { key: "type", label: "Loại", render: (r) => (r.isSystem ? <Badge tone="info">Mặc định</Badge> : <Badge>Tự tạo</Badge>) },
  ];
  return (
    <DataTable id="roles" columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/system/roles/${r.id}`}
      rowActions={(r) => [
        { key: "view", label: "Xem", icon: "eye", href: `/system/roles/${r.id}` },
        { key: "edit", label: "Sửa quyền", icon: "pencil", href: `/system/roles/${r.id}?edit=permissions` },
      ]} />
  );
}
