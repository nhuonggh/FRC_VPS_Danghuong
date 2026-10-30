"use client";

import { igArea, igInput, InlineField } from "@/components/ui";
import { Check, ChevronDown, ChevronRight, Lock, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
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
          <InlineField id="name" label="Tên nhóm quyền" error={errors.name?.message} hint={p.role.isSystem ? "Nhóm mặc định của hệ thống không đổi tên." : undefined} readOnly={p.role.isSystem}>
            <input id="name" disabled={p.role.isSystem} {...s.form.register("name")} aria-invalid={!!errors.name} className={igInput} />
          </InlineField>
          <InlineField id="description" label="Mô tả" multiline error={errors.description?.message}>
            <textarea id="description" rows={3} {...s.form.register("description")} aria-invalid={!!errors.description} className={igArea} />
          </InlineField>
        </div>
      ) : (
        <dl className="grid gap-x-8 gap-y-2 md:grid-cols-2"><DetailField label="Tên nhóm">{p.role.name}</DetailField><DetailField label="Mô tả">{p.role.description}</DetailField></dl>
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

/** Nhãn dạng "Tên (ghi chú)" → tách ghi chú xuống dòng phụ cho đỡ rối. */
const splitLabel = (label: string) => {
  const m = /^(.*?)\s*\(([^()]+)\)$/.exec(label);
  return m ? { title: m[1]!, hint: m[2]! } : { title: label, hint: undefined };
};
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();

function PermissionsSection({ ctx, p }: { ctx: TabRenderCtx; p: Props }) {
  const s = useSectionForm(ctx, "permissions", {
    schema: rolePermissionsSchema, defaults: { codes: inCatalogOrder(p.catalog, p.role.permissionCodes) },
    save: (v) => apiFetch(`/api/roles/${p.role.id}/section-update`, { method: "PATCH", json: { section: "permissions", codes: v.codes } }).then(() => {}),
  });
  const [query, setQuery] = useState("");
  const [onlySensitive, setOnlySensitive] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const selected = s.form.watch("codes");
  const set = (codes: Iterable<string>) => s.form.setValue("codes", inCatalogOrder(p.catalog, codes), { shouldDirty: true });
  const held = new Set(p.actorPerms);
  const original = new Set(p.role.permissionCodes);
  // Được bật/tắt khi: người sửa có quyền đó, HOẶC nhóm đã có sẵn quyền đó (giữ nguyên/gỡ đều không phải "thêm quyền mới")
  const canToggle = (code: string) => held.has(code) || original.has(code);
  const current = s.editing ? selected : p.role.permissionCodes;
  const allGroups = groups(p.catalog);
  const sensitiveCount = p.catalog.filter((c) => c.sensitive).length;
  const grantedCount = p.catalog.filter((c) => current.includes(c.code)).length;
  const q = norm(query.trim());
  const filtering = q !== "" || onlySensitive;
  const matches = (i: CatalogItem) => (!onlySensitive || i.sensitive) && (q === "" || norm(i.label).includes(q) || norm(i.code).includes(q));
  const toggleCollapse = (g: string) => setCollapsed((c) => { const n = new Set(c); if (!n.delete(g)) n.add(g); return n; });
  const visible = allGroups.map((g) => ({ ...g, shown: g.items.filter(matches) })).filter((g) => !filtering || g.shown.length > 0);
  return (
    <DetailSection title="Quyền theo chức năng" editing={s.editing}
      action={s.editing ? <EditActions saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} /> : <EditButton label="Chỉnh sửa quyền" onClick={() => ctx.beginEdit("permissions")} />}>
      <p className="mb-3 text-xs text-fg-muted">
        Đang cấp {formatNumber(grantedCount)}/{formatNumber(p.catalog.length)} quyền. Có {formatNumber(sensitiveCount)} quyền được đánh dấu nhạy cảm.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative block w-full sm:w-72">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm quyền…" aria-label="Tìm quyền"
            className="h-11 w-full rounded-sm border border-border bg-surface pl-9 pr-3 text-sm md:h-10" />
        </label>
        <div role="group" aria-label="Lọc quyền" className="flex rounded-sm bg-hover p-1 text-sm">
          {([[false, `Tất cả (${p.catalog.length})`], [true, `Nhạy cảm (${sensitiveCount})`]] as const).map(([v, label]) => (
            <button key={label} type="button" aria-pressed={onlySensitive === v} onClick={() => setOnlySensitive(v)}
              className={`h-9 rounded-sm px-3 font-medium md:h-8 ${onlySensitive === v ? "bg-surface text-accent shadow-sm" : "text-fg-secondary"}`}>{label}</button>
          ))}
        </div>
        <div className="ml-auto flex gap-4 text-sm font-medium text-accent">
          <button type="button" onClick={() => setCollapsed(new Set())}>Mở rộng tất cả</button>
          <button type="button" onClick={() => setCollapsed(new Set(allGroups.map((g) => g.group)))}>Thu gọn tất cả</button>
        </div>
      </div>
      {visible.length === 0 && <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Không có quyền nào khớp.</p>}
      <div className="gap-4 md:columns-2 xl:columns-3">
        {visible.map(({ group, items, shown }) => {
          const granted = items.filter((i) => current.includes(i.code));
          const selectable = items.filter((i) => canToggle(i.code));
          const allOn = selectable.length > 0 && selectable.every((i) => selected.includes(i.code));
          const headingId = `perm-group-${cssId(group)}`;
          const open = filtering || !collapsed.has(group);
          const rows = s.editing ? shown : shown.filter((i) => current.includes(i.code));
          return (
            <div key={group} role="group" aria-labelledby={headingId} className="mb-4 break-inside-avoid overflow-hidden rounded-md border border-border bg-surface">
              <div className="flex items-center gap-2 bg-hover/50 pr-3">
                <h3 id={headingId} className="min-w-0 flex-1 text-sm font-semibold">
                  <button type="button" aria-expanded={open} onClick={() => toggleCollapse(group)} className="flex min-h-11 w-full items-center gap-2 px-3 text-left md:min-h-10">
                    {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                    <span className="truncate">{group}</span>
                  </button>
                </h3>
                {s.editing && selectable.length > 0 && (
                  <button type="button" aria-label={`${allOn ? "Bỏ chọn nhóm" : "Chọn cả nhóm"} ${group}`}
                    className="h-9 rounded-sm px-2 text-xs font-medium text-accent hover:bg-hover"
                    onClick={() => set(allOn
                      ? selected.filter((c) => !selectable.some((i) => i.code === c))
                      : [...new Set([...selected, ...selectable.map((i) => i.code)])])}>
                    {allOn ? "Bỏ chọn nhóm" : "Chọn cả nhóm"}
                  </button>
                )}
                <Badge tone={granted.length === items.length ? "success" : "neutral"}><span className="tabular">{formatNumber(granted.length)}/{formatNumber(items.length)}</span></Badge>
              </div>
              {open && (rows.length === 0
                ? <p className="border-t border-border px-3 py-2 text-sm text-fg-muted">Không có quyền nào.</p>
                : (
                  <ul className="divide-y divide-[var(--border-default)] border-t border-border">
                    {rows.map((i) => {
                      const ok = canToggle(i.code);
                      const { title, hint } = splitLabel(i.label);
                      const sensId = `sens-${cssId(i.code)}`;
                      const noteId = `note-${cssId(i.code)}`;
                      const sub = [hint, !ok && s.editing ? "Bạn không có quyền này nên không thể cấp." : null].filter(Boolean).join(" · ");
                      const describedBy = [i.sensitive ? sensId : null, sub ? noteId : null].filter(Boolean).join(" ") || undefined;
                      return (
                        <li key={i.code} className="flex items-start gap-2 px-3 py-2 hover:bg-hover">
                          <div className="min-w-0 flex-1">
                            {s.editing ? (
                              <label className={`flex min-h-9 items-center gap-2 text-sm ${ok ? "" : "text-fg-muted"}`}>
                                <input type="checkbox" checked={selected.includes(i.code)} disabled={!ok} aria-describedby={describedBy}
                                  onChange={(e) => set(e.target.checked ? [...selected, i.code] : selected.filter((c) => c !== i.code))} />
                                {title}
                              </label>
                            ) : (
                              <div className="flex items-start gap-2 text-sm"><Check size={14} aria-hidden className="mt-1 shrink-0 text-success" />{title}</div>
                            )}
                            {sub && <p id={noteId} className="pl-6 text-xs text-fg-muted">{sub}</p>}
                          </div>
                          {i.sensitive && <span id={sensId} className="shrink-0"><Badge tone="warning"><Lock size={11} aria-hidden className="mr-1 inline" />Nhạy cảm</Badge></span>}
                        </li>
                      );
                    })}
                  </ul>
                ))}
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
