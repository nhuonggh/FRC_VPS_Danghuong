"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Badge } from "@/components/ui/Badge";
import {
  DetailField, DetailPage, DetailSection, EditActions, EditButton, useDetailNav, useSectionForm, type TabRenderCtx,
} from "@/components/ui/DetailPage";
import { toastApiError } from "@/lib/api-error-toast";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { formatNumber } from "@/lib/format";
import { toast } from "@/lib/toast";
import { roleInfoSchema, rolePermissionsSchema } from "@/server/roles/schemas";

interface CatalogItem { code: string; label: string; group: string; sensitive?: boolean }
interface Props {
  role: { id: number; name: string; description: string | null; isSystem: boolean; permissionCodes: string[]; users: { id: number; username: string; fullName: string; isLocked: boolean }[] };
  catalog: CatalogItem[];
  /** Quyền hiệu lực của người đang sửa: chỉ được THÊM quyền mình có (máy chủ cũng chặn); gỡ quyền thì luôn được. */
  actorPerms: string[];
  /** user.view — có thì tên người dùng/số người dùng là liên kết, không thì chữ thường (tránh dẫn tới trang 403). */
  canViewUsers: boolean;
}

const groups = (catalog: CatalogItem[]) => [...new Set(catalog.map((c) => c.group))].map((g) => ({ group: g, items: catalog.filter((c) => c.group === g) }));
const usersHref = (roleId: number) => `/system/users?role=${roleId}`;

function InfoSection({ ctx, p }: { ctx: TabRenderCtx; p: Props }) {
  const s = useSectionForm(ctx, "info", {
    schema: roleInfoSchema, defaults: { name: p.role.name, description: p.role.description ?? "" },
    // LUÔN gửi description: máy chủ coi thiếu/rỗng là xóa mô tả
    save: (v) => apiFetch(`/api/roles/${p.role.id}/section-update`, { method: "PATCH", json: { section: "info", name: v.name, description: v.description ?? "" } }).then(() => {}),
  });
  const errors = s.form.formState.errors;
  return (
    <DetailSection title="Thông tin nhóm" editing={s.editing}
      action={s.editing ? <EditActions saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} /> : <EditButton label="Chỉnh sửa thông tin nhóm" onClick={() => ctx.beginEdit("info")} />}>
      {s.editing ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="name" className="mb-1 block text-xs text-fg-muted">Tên nhóm quyền</label>
            <input id="name" disabled={p.role.isSystem} {...s.form.register("name")} aria-invalid={!!errors.name}
              aria-describedby={p.role.isSystem ? "name-hint" : errors.name ? "name-error" : undefined}
              className={`h-11 w-full rounded-sm border bg-canvas px-3 text-sm disabled:bg-hover md:h-9 ${errors.name ? "border-danger" : "border-border"}`} />
            {p.role.isSystem && <p id="name-hint" className="mt-1 text-xs text-fg-muted">Nhóm mặc định của hệ thống không đổi tên.</p>}
            {errors.name && <p id="name-error" className="mt-1 text-xs text-danger">{errors.name.message}</p>}
          </div>
          <div>
            <label htmlFor="description" className="mb-1 block text-xs text-fg-muted">Mô tả</label>
            <textarea id="description" rows={3} {...s.form.register("description")} aria-invalid={!!errors.description}
              aria-describedby={errors.description ? "description-error" : undefined}
              className={`w-full rounded-sm border bg-canvas px-3 py-2 text-sm ${errors.description ? "border-danger" : "border-border"}`} />
            {errors.description && <p id="description-error" className="mt-1 text-xs text-danger">{errors.description.message}</p>}
          </div>
        </div>
      ) : (
        <dl className="space-y-2"><DetailField label="Tên nhóm">{p.role.name}</DetailField><DetailField label="Mô tả">{p.role.description}</DetailField></dl>
      )}
    </DetailSection>
  );
}

const cssId = (code: string) => code.replace(/[^a-zA-Z0-9]/g, "-");

/**
 * Đưa tập mã về THỨ TỰ DANH MỤC (mã lạ, nếu có, giữ nguyên thứ tự và xếp cuối). RHF so sánh mảng theo thứ tự nên tắt rồi
 * bật lại một quyền mà nối vào cuối sẽ bị coi là "đã sửa" (isDirty) dù tập mã y hệt → hỏi xác nhận bỏ thay đổi oan.
 * Dùng cho CẢ giá trị gốc lẫn mọi lần đổi để hai bên luôn cùng thứ tự.
 */
const inCatalogOrder = (catalog: CatalogItem[], codes: Iterable<string>): string[] => {
  const want = new Set(codes);
  const known = catalog.map((c) => c.code);
  const knownSet = new Set(known);
  return [...known.filter((c) => want.has(c)), ...[...want].filter((c) => !knownSet.has(c))];
};

function PermissionsSection({ ctx, p }: { ctx: TabRenderCtx; p: Props }) {
  const s = useSectionForm(ctx, "permissions", {
    schema: rolePermissionsSchema, defaults: { codes: inCatalogOrder(p.catalog, p.role.permissionCodes) },
    save: (v) => apiFetch(`/api/roles/${p.role.id}/section-update`, { method: "PATCH", json: { section: "permissions", codes: v.codes } }).then(() => {}),
  });
  const selected = s.form.watch("codes");
  const set = (codes: Iterable<string>) => s.form.setValue("codes", inCatalogOrder(p.catalog, codes), { shouldDirty: true });
  const held = new Set(p.actorPerms);
  const original = new Set(p.role.permissionCodes);
  // Được bật/tắt khi: người sửa có quyền đó, HOẶC nhóm đã có sẵn quyền đó (giữ nguyên/gỡ đều không phải "thêm quyền mới")
  const canToggle = (code: string) => held.has(code) || original.has(code);
  return (
    <DetailSection title="Quyền theo chức năng" editing={s.editing}
      action={s.editing ? <EditActions saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} /> : <EditButton label="Chỉnh sửa quyền" onClick={() => ctx.beginEdit("permissions")} />}>
      <div className="space-y-5">
        {groups(p.catalog).map(({ group, items }) => {
          const current = s.editing ? selected : p.role.permissionCodes;
          const granted = items.filter((i) => current.includes(i.code));
          const selectable = items.filter((i) => canToggle(i.code));
          const allOn = selectable.length > 0 && selectable.every((i) => selected.includes(i.code));
          const headingId = `perm-group-${cssId(group)}`;
          return (
            <div key={group} role="group" aria-labelledby={headingId}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 id={headingId} className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">{group} <span className="tabular text-fg-muted">({formatNumber(granted.length)}/{formatNumber(items.length)})</span></h3>
                {s.editing && selectable.length > 0 && (
                  <button type="button" aria-label={`${allOn ? "Bỏ chọn nhóm" : "Chọn cả nhóm"} ${group}`}
                    className="h-11 rounded-sm px-2 text-xs font-medium text-accent hover:bg-hover md:h-8"
                    onClick={() => set(allOn
                      ? selected.filter((c) => !selectable.some((i) => i.code === c))
                      : [...new Set([...selected, ...selectable.map((i) => i.code)])])}>
                    {allOn ? "Bỏ chọn nhóm" : "Chọn cả nhóm"}
                  </button>
                )}
              </div>
              {s.editing ? (
                <div className="grid gap-1 sm:grid-cols-2">
                  {items.map((i) => {
                    const ok = canToggle(i.code);
                    const sensId = `sens-${cssId(i.code)}`;
                    const noteId = `note-${cssId(i.code)}`;
                    const describedBy = [i.sensitive ? sensId : null, ok ? null : noteId].filter(Boolean).join(" ") || undefined;
                    return (
                      <div key={i.code} className="flex flex-wrap items-center gap-x-2 rounded-sm px-2 hover:bg-hover">
                        <label className={`flex min-h-11 items-center gap-2 text-sm md:min-h-9 ${ok ? "" : "text-fg-muted"}`}>
                          <input type="checkbox" checked={selected.includes(i.code)} disabled={!ok} aria-describedby={describedBy}
                            onChange={(e) => set(e.target.checked ? [...selected, i.code] : selected.filter((c) => c !== i.code))} />
                          {i.label}
                        </label>
                        {i.sensitive && <span id={sensId}><Badge tone="warning">Nhạy cảm</Badge></span>}
                        {!ok && <span id={noteId} className="text-xs text-fg-muted">Bạn không có quyền này nên không thể cấp.</span>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <ul className="grid gap-1 sm:grid-cols-2">
                  {granted.length === 0
                    ? <li className="text-sm text-fg-muted">Không có quyền nào.</li>
                    : granted.map((i) => (
                        <li key={i.code} className="text-sm">{i.label}{i.sensitive && <Badge tone="warning" className="ml-2">Nhạy cảm</Badge>}</li>
                      ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </DetailSection>
  );
}

export function RoleDetail(p: Props) {
  const router = useRouter();
  const nav = useDetailNav(["info", "permissions", "users"], { info: "info", permissions: "permissions" });
  const busy = useRef(false);
  const userCount = p.role.users.length;
  const canDelete = !p.role.isSystem && userCount === 0; // nhóm còn người dùng: ẩn nút (máy chủ vẫn chặn nếu có đua)

  async function remove() {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!(await confirm({ title: `Xóa nhóm quyền “${p.role.name}”?`, description: "Không thể hoàn tác.", confirmLabel: "Xóa", danger: true }))) return;
      try {
        await apiFetch(`/api/roles/${p.role.id}`, { method: "DELETE" });
        toast.success("Đã xóa nhóm quyền.");
        router.replace("/system/roles");
      } catch (e) { toastApiError(e, "Không xóa được nhóm quyền."); }
    } finally { busy.current = false; }
  }

  return (
    <DetailPage
      backHref="/system/roles" backLabel="Quay lại nhóm quyền"
      headerActions={canDelete && (
        <button type="button" onClick={() => void remove()} className="flex h-11 items-center gap-2 rounded-sm border border-danger px-3 text-sm font-medium text-danger hover:bg-danger-soft md:h-10">
          <Trash2 size={16} aria-hidden /> Xóa nhóm
        </button>
      )}
      summary={{
        title: p.role.name,
        badges: [p.role.isSystem ? { label: "Mặc định", tone: "info" } : { label: "Tự tạo" }],
        facts: [
          { label: "Số quyền", value: formatNumber(p.role.permissionCodes.length) },
          {
            label: "Người dùng",
            value: p.canViewUsers && userCount > 0
              ? <Link href={usersHref(p.role.id)} className="font-medium text-accent hover:underline">{formatNumber(userCount)}</Link>
              : formatNumber(userCount),
          },
        ],
      }}
      tabs={[
        { key: "info", label: "Thông tin", render: (ctx) => <InfoSection ctx={ctx} p={p} /> },
        { key: "permissions", label: "Quyền", count: p.role.permissionCodes.length, render: (ctx) => <PermissionsSection ctx={ctx} p={p} /> },
        {
          key: "users", label: "Người dùng", count: userCount,
          render: () => userCount === 0
            ? <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Chưa có người dùng nào thuộc nhóm này.</p>
            : (
              <div className="space-y-3">
                <ul className="divide-y divide-[var(--border-default)]">
                  {p.role.users.map((u) => (
                    <li key={u.id} className="py-2 text-sm">
                      {p.canViewUsers
                        ? <Link href={`/system/users/${u.id}`} className="font-medium hover:text-accent">{u.fullName}</Link>
                        : <span className="font-medium">{u.fullName}</span>}
                      <span className="ml-2 font-mono text-xs text-fg-muted">{u.username}</span>
                      {u.isLocked && <span className="ml-2 text-xs text-danger">Đã khóa</span>}
                    </li>
                  ))}
                </ul>
                {p.canViewUsers && <Link href={usersHref(p.role.id)} className="inline-block text-sm font-medium text-accent">Xem trong danh sách người dùng</Link>}
                {!p.role.isSystem && <p className="text-xs text-fg-muted">Muốn xóa nhóm này, hãy chuyển hết người dùng sang nhóm khác trước khi xóa.</p>}
              </div>
            ),
        },
      ]}
      {...nav}
    />
  );
}
