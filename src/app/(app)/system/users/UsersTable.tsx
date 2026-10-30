"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { TempPasswordDialog } from "@/components/ui/TempPasswordDialog";
import { apiFetch } from "@/lib/api-fetch";
import { toastApiError } from "@/lib/api-error-toast";
import { confirm } from "@/lib/confirm-store";
import { NULL_TEXT } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { toast } from "@/lib/toast";
import type { UserRow } from "@/server/users/queries";

export function UsersTable({
  rows, canManage, selfId, params,
}: { rows: UserRow[]; canManage: boolean; selfId: number; params: ListParams }) {
  const router = useRouter();
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);
  const busy = useRef(false); // 1 thao tác ghi tại một thời điểm (chặn bấm liên tiếp nhiều dòng)

  const columns: Column<UserRow>[] = [
    { key: "fullName", label: "Họ tên", sortable: true, primaryOnMobile: true, render: (u) => u.fullName },
    { key: "username", label: "Tên đăng nhập", sortable: true, render: (u) => <span className="font-mono text-xs">{u.username}</span> },
    { key: "email", label: "Email", render: (u) => u.email ? <span className="break-all text-xs">{u.email}</span> : NULL_TEXT },
    { key: "roles", label: "Nhóm quyền", render: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.id} tone="info">{r.name}</Badge>)}</div> },
    { key: "status", label: "Trạng thái", render: (u) => (u.isLocked ? <Badge tone="danger">Đã khóa</Badge> : <Badge tone="success">Hoạt động</Badge>) },
    { key: "canAdvance", label: "Người ứng tiền", render: (u) => (u.canAdvance ? <Badge tone="info">Được ứng tiền</Badge> : NULL_TEXT) },
  ];

  async function guarded(fn: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    try { await fn(); } finally { busy.current = false; }
  }

  const toggleLock = (u: UserRow) => guarded(async () => {
    const lock = !u.isLocked;
    const ok = await confirm({
      title: lock ? `Khóa tài khoản ${u.username}?` : `Mở khóa tài khoản ${u.username}?`,
      description: lock ? "Người này sẽ bị đăng xuất ở thao tác kế tiếp và không đăng nhập được." : "Người này có thể đăng nhập lại.",
      confirmLabel: lock ? "Khóa" : "Mở khóa", danger: lock,
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/users/${u.id}/lock`, { method: "POST", json: { locked: lock } });
      toast.success(lock ? "Đã khóa tài khoản." : "Đã mở khóa tài khoản.");
      router.refresh();
    } catch (e) {
      toastApiError(e);
    }
  });

  const toggleAdvance = (u: UserRow) => guarded(async () => {
    try {
      await apiFetch(`/api/users/${u.id}/can-advance`, { method: "POST", json: { canAdvance: !u.canAdvance } });
      toast.success(u.canAdvance ? `Đã bỏ ${u.fullName} khỏi danh sách người ứng tiền.` : `Đã thêm ${u.fullName} vào danh sách người ứng tiền.`);
      router.refresh();
    } catch (e) {
      toastApiError(e);
    }
  });

  const reset = (u: UserRow) => guarded(async () => {
    if (!(await confirm({ title: `Cấp lại mật khẩu cho ${u.username}?`, description: "Mật khẩu cũ mất hiệu lực ngay.", confirmLabel: "Cấp lại", danger: true }))) return;
    try {
      const r = await apiFetch<{ tempPassword: string }>(`/api/users/${u.id}/reset-password`, { method: "POST" });
      setTemp({ username: u.username, password: r.tempPassword });
    } catch (e) {
      toastApiError(e);
    }
  });

  // Thứ tự cố định "Xem → Sửa → Khóa/Mở khóa → Cấp lại mật khẩu"; thao tác ghi CHỈ có khi user.manage (ẩn, không disabled)
  const actions = (u: UserRow): RowAction[] => [
    { key: "view", label: "Xem", icon: "eye", href: `/system/users/${u.id}` },
    ...(canManage ? [
      { key: "edit", label: "Sửa", icon: "pencil" as const, href: `/system/users/${u.id}?edit=profile` },      ...(u.id === selfId ? [] : [{ key: "lock", label: u.isLocked ? "Mở khóa" : "Khóa", icon: "lock" as const, danger: !u.isLocked, onClick: () => void toggleLock(u) }]),
      // Chính mình: không tự cấp lại mật khẩu → trỏ sang trang đổi mật khẩu
      u.id === selfId
        ? { key: "change-password", label: "Đổi mật khẩu của tôi", icon: "lock" as const, href: "/change-password" }
        : { key: "reset", label: "Cấp lại mật khẩu", icon: "pencil" as const, onClick: () => void reset(u) },
      { key: "advance", label: u.canAdvance ? "Bỏ khỏi người ứng tiền" : "Cho phép ứng tiền", icon: "power" as const, onClick: () => void toggleAdvance(u) },
    ] : []),
  ];

  return (
    <>
      <DataTable id="users" columns={columns} rows={rows} rowKey={(u) => u.id} rowHref={(u) => `/system/users/${u.id}`}
        rowActions={actions} sort={params.sort} buildSortHref={(s) => buildListHref("/system/users", params, { sort: s })} />
      <TempPasswordDialog open={!!temp} username={temp?.username ?? ""} password={temp?.password ?? null} onClose={() => { setTemp(null); router.refresh(); }} />
    </>
  );
}
