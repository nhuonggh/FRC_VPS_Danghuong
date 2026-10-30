"use client";

import { igInput, InlineField } from "@/components/ui";
import { Banknote, KeyRound, Lock, Unlock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  DetailField, DetailPage, DetailSection, EditActions, EditButton, useDetailNav, useSectionForm, type TabRenderCtx,
} from "@/components/ui/DetailPage";
import { TempPasswordDialog } from "@/components/ui/TempPasswordDialog";
import { apiFetch } from "@/lib/api-fetch";
import { toastApiError } from "@/lib/api-error-toast";
import { confirm } from "@/lib/confirm-store";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { emailSectionSchema, profileSectionSchema, rolesSectionSchema } from "@/server/users/schemas";

interface Props {
  user: { id: number; username: string; fullName: string; email: string | null; isLocked: boolean; canAdvance: boolean; mustChangePassword: boolean; createdAt: string; roles: { id: number; name: string }[] };
  roles: { id: number; name: string }[];
  history: { id: number; action: string; at: string; by: string }[];
  /** user.manage — không có thì mọi phần là chữ tĩnh, không bút chì, không nút Khóa/Cấp lại mật khẩu. */
  canManage: boolean;
  isSelf: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  "user.create": "Tạo tài khoản", "user.update_profile": "Sửa họ tên", "user.set_email": "Đổi email đăng nhập Google", "user.set_roles": "Đổi nhóm quyền",
  "user.set_can_advance": "Đổi quyền ứng tiền chi phí", "user.lock": "Khóa tài khoản", "user.unlock": "Mở khóa tài khoản", "user.reset_password": "Cấp lại mật khẩu", "user.change_password": "Đổi mật khẩu",
};

function ProfileSection({ ctx, p }: { ctx: TabRenderCtx; p: Props }) {
  const s = useSectionForm(ctx, "profile", {
    schema: profileSectionSchema, defaults: { fullName: p.user.fullName },
    save: (v) => apiFetch(`/api/users/${p.user.id}/section-update`, { method: "PATCH", json: { section: "profile", ...v } }).then(() => {}),
  });
  const editing = p.canManage && s.editing; // ?edit=profile trên URL không mở form sửa cho người chỉ được xem
  return (
    <DetailSection title="Thông tin cơ bản" editing={editing}
      action={!p.canManage ? null : editing
        ? <EditActions saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} />
        : <EditButton label="Chỉnh sửa thông tin cơ bản" onClick={() => ctx.beginEdit("profile")} />}>
      {editing ? (
        <InlineField id="fullName" label="Họ tên" error={s.form.formState.errors.fullName?.message}>
          <input id="fullName" {...s.form.register("fullName")} aria-invalid={!!s.form.formState.errors.fullName} className={igInput} />
        </InlineField>
      ) : (
        <dl className="grid gap-x-8 gap-y-2 md:grid-cols-2">
          <DetailField label="Họ tên">{p.user.fullName}</DetailField>
          <DetailField label="Tên đăng nhập">{p.user.username}</DetailField>
          <DetailField label="Tạo lúc">{formatDateTime(p.user.createdAt)}</DetailField>
        </dl>
      )}
    </DetailSection>
  );
}

/** Email = khoá đăng nhập Google (khớp chính xác). Không có email → tài khoản chỉ đăng nhập bằng mật khẩu. */
function EmailSection({ ctx, p }: { ctx: TabRenderCtx; p: Props }) {
  const s = useSectionForm(ctx, "email", {
    schema: emailSectionSchema, defaults: { email: p.user.email ?? "" },
    save: (v) => apiFetch(`/api/users/${p.user.id}/section-update`, { method: "PATCH", json: { section: "email", ...v } }).then(() => {}),
  });
  const editing = p.canManage && s.editing;
  const err = s.form.formState.errors.email;
  return (
    <DetailSection title="Đăng nhập Google" editing={editing}
      action={!p.canManage ? null : editing
        ? <EditActions saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} />
        : <EditButton label="Chỉnh sửa email đăng nhập Google" onClick={() => ctx.beginEdit("email")} />}>
      {editing ? (
        <InlineField id="email" label="Email" error={err?.message} hint="Tài khoản Google (đã xác minh) có đúng email này sẽ đăng nhập được vào tài khoản này. Để trống = chỉ đăng nhập bằng mật khẩu.">
          <input id="email" type="email" inputMode="email" autoComplete="off" {...s.form.register("email")} aria-invalid={!!err} className={igInput} />
        </InlineField>
      ) : (
        <dl><DetailField label="Email">{p.user.email}</DetailField></dl>
      )}
    </DetailSection>
  );
}

function RolesSection({ ctx, p }: { ctx: TabRenderCtx; p: Props }) {
  const current = p.user.roles.map((r) => r.id);
  const s = useSectionForm(ctx, "roles", {
    schema: rolesSectionSchema, defaults: { roleIds: current },
    save: (v) => apiFetch(`/api/users/${p.user.id}/section-update`, { method: "PATCH", json: { section: "roles", ...v } }).then(() => {}),
  });
  const selected = s.form.watch("roleIds");
  const editing = p.canManage && s.editing;
  return (
    <DetailSection title="Nhóm quyền" editing={editing}
      action={!p.canManage ? null : editing
        ? <EditActions saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} />
        : <EditButton label="Chỉnh sửa nhóm quyền" onClick={() => ctx.beginEdit("roles")} />}>
      {editing ? (
        <fieldset className="space-y-2">
          <legend className="sr-only">Nhóm quyền</legend>
          {p.roles.map((r) => (
            <label key={r.id} className="flex min-h-10 items-center gap-3 rounded-sm border border-border p-3 text-sm">
              <input type="checkbox" checked={selected.includes(r.id)}
                onChange={(e) => s.form.setValue("roleIds", e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id), { shouldDirty: true, shouldValidate: true })} />
              {r.name}
            </label>
          ))}
          {s.form.formState.errors.roleIds && <p className="text-xs text-danger">{s.form.formState.errors.roleIds.message}</p>}
        </fieldset>
      ) : (
        <dl><DetailField label="Đang thuộc">{p.user.roles.map((r) => r.name).join(", ")}</DetailField></dl>
      )}
    </DetailSection>
  );
}

export function UserDetail(p: Props) {
  const router = useRouter();
  const nav = useDetailNav(["info", "roles", "history"], { profile: "info", email: "info", roles: "roles" });
  const [temp, setTemp] = useState<string | null>(null);
  const busy = useRef(false); // 1 thao tác ghi (khóa / cấp lại mật khẩu) tại một thời điểm

  async function guarded(fn: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    try { await fn(); } finally { busy.current = false; }
  }

  const toggleLock = () => guarded(async () => {
    const lock = !p.user.isLocked;
    if (!(await confirm({
      title: lock ? `Khóa tài khoản ${p.user.username}?` : `Mở khóa tài khoản ${p.user.username}?`,
      description: lock ? "Người này sẽ bị đăng xuất ở thao tác kế tiếp và không đăng nhập được." : "Người này có thể đăng nhập lại.",
      confirmLabel: lock ? "Khóa" : "Mở khóa", danger: lock,
    }))) return;
    try {
      await apiFetch(`/api/users/${p.user.id}/lock`, { method: "POST", json: { locked: lock } });
      toast.success(lock ? "Đã khóa tài khoản." : "Đã mở khóa tài khoản.");
      router.refresh();
    } catch (e) { toastApiError(e); }
  });

  const toggleAdvance = () => guarded(async () => {
    try {
      await apiFetch(`/api/users/${p.user.id}/can-advance`, { method: "POST", json: { canAdvance: !p.user.canAdvance } });
      toast.success(p.user.canAdvance ? "Đã bỏ khỏi danh sách người ứng tiền." : "Đã thêm vào danh sách người ứng tiền.");
      router.refresh();
    } catch (e) { toastApiError(e); }
  });

  const reset = () => guarded(async () => {
    if (!(await confirm({ title: `Cấp lại mật khẩu cho ${p.user.username}?`, description: "Mật khẩu cũ mất hiệu lực ngay.", confirmLabel: "Cấp lại", danger: true }))) return;
    try {
      const r = await apiFetch<{ tempPassword: string }>(`/api/users/${p.user.id}/reset-password`, { method: "POST" });
      setTemp(r.tempPassword);
    } catch (e) { toastApiError(e); }
  });

  const actionBtn = "flex h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm font-medium hover:bg-hover md:h-10";
  return (
    <>
      <DetailPage
        backHref="/system/users" backLabel="Quay lại người dùng"
        headerActions={
          <>
            {p.canManage && (
              <button type="button" onClick={() => void toggleAdvance()} className={actionBtn}><Banknote size={16} aria-hidden /> {p.user.canAdvance ? "Bỏ khỏi người ứng tiền" : "Cho phép ứng tiền"}</button>
            )}
            {p.canManage && !p.isSelf && (
              <>
                <button type="button" onClick={() => void toggleLock()} className={actionBtn}>
                  {p.user.isLocked ? <Unlock size={16} aria-hidden /> : <Lock size={16} aria-hidden />}
                  {p.user.isLocked ? "Mở khóa" : "Khóa"}
                </button>
                <button type="button" onClick={() => void reset()} className={actionBtn}><KeyRound size={16} aria-hidden /> Cấp lại mật khẩu</button>
              </>
            )}
            {/* Tài khoản của chính mình: không tự cấp lại mật khẩu (sinh mật khẩu tạm cho chính mình vô nghĩa) → đổi qua trang riêng */}
            {p.isSelf && <Link href="/change-password" className={actionBtn}><KeyRound size={16} aria-hidden /> Đổi mật khẩu của tôi</Link>}
          </>
        }
        summary={{
          title: p.user.fullName, code: p.user.username,
          badges: [p.user.isLocked ? { label: "Đã khóa", tone: "danger" } : { label: "Hoạt động", tone: "success" },
                   ...(p.user.canAdvance ? [{ label: "Người ứng tiền", tone: "info" as const }] : []),
                   ...(p.user.mustChangePassword ? [{ label: "Chờ đổi mật khẩu", tone: "warning" as const }] : [])],
          facts: [{ label: "Nhóm quyền", value: p.user.roles.length }, { label: "Tạo lúc", value: formatDateTime(p.user.createdAt) }],
        }}
        tabs={[
          { key: "info", label: "Thông tin", render: (ctx) => <div className="space-y-6"><ProfileSection ctx={ctx} p={p} /><EmailSection ctx={ctx} p={p} /></div> },
          { key: "roles", label: "Nhóm quyền", count: p.user.roles.length, render: (ctx) => <RolesSection ctx={ctx} p={p} /> },
          {
            key: "history", label: "Nhật ký", count: p.history.length,
            render: () => p.history.length === 0
              ? <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Chưa có thao tác nào ghi nhận.</p>
              : <ul className="divide-y divide-[var(--border-default)]">
                  {p.history.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span>{ACTION_LABEL[h.action] ?? h.action} <span className="text-fg-muted">— {h.by}</span></span>
                      <span className="tabular text-xs text-fg-muted">{formatDateTime(h.at)}</span>
                    </li>
                  ))}
                </ul>,
          },
        ]}
        {...nav}
        initialEditing={p.canManage ? nav.initialEditing : null}
      />
      <TempPasswordDialog open={temp !== null} username={p.user.username} password={temp} onClose={() => { setTemp(null); router.refresh(); }} />
    </>
  );
}
