"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { InlineField, igInput } from "@/components/sales/InlineField";
import type { ComboOption } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";

export type QuickCustomer = ComboOption & { address?: string; taxCode?: string; deliveryAddress?: string };

const EMPTY = { code: "", name: "", phone: "", email: "", address: "", taxCode: "", bankAccount: "", representative: "", sortOrder: "", openingDebt: "", debtLimit: "", deliveryAddress: "" };
const LABEL = "sm:min-w-40";

/** Hộp thoại thêm khách hàng / nhà cung cấp ngay trong form lập đơn: đủ thông tin như màn nhập cũ. Mã để trống thì hệ thống tự cấp. */
export function QuickCustomerDialog({ groups, onCreated, kind = "customer" }: { groups: ComboOption[]; onCreated: (c: QuickCustomer) => void; kind?: "customer" | "supplier" }) {
  const noun = kind === "supplier" ? "nhà cung cấp" : "khách hàng";
  const idem = useIdempotencyKey();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(EMPTY);
  const [alsoSupplier, setAlsoSupplier] = useState(false);
  const [isExpense, setIsExpense] = useState(false);
  const [groupId, setGroupId] = useState<string>(groups[0] ? String(groups[0].value) : "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => { setV((s) => ({ ...s, [k]: e.target.value })); setFieldErrors((f) => (f[k] ? { ...f, [k]: "" } : f)); };
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

  async function save() {
    if (busy) return;
    const errs: Record<string, string> = {};
    if (!v.name.trim()) errs.name = `Nhập tên ${noun}.`;
    if (!groupId) errs.groupId = `Chọn nhóm.`;
    for (const k of ["sortOrder", "openingDebt", "debtLimit"] as const) if (v[k].trim() !== "" && !Number.isFinite(Number(v[k]))) errs[k] = "Nhập số.";
    if (Number(v.debtLimit) < 0) errs.debtLimit = "Không được âm.";
    if (Object.keys(errs).length) { setFieldErrors(errs); setError("Vui lòng nhập các trường bắt buộc (*) và sửa ô báo lỗi."); return; }
    setBusy(true); setError(null); setFieldErrors({});
    const debtLimit = num(v.debtLimit) ?? 0;
    try {
      const r = await apiFetch<{ id: number; code: string }>("/api/partners", {
        method: "POST", idempotencyKey: idem.key,
        json: {
          code: v.code.trim(), name: v.name.trim(), groupId: Number(groupId), isCustomer: kind !== "supplier", isSupplier: kind === "supplier" || alsoSupplier, isExpense, ownerUserId: null,
          debtLimit, allowCredit: debtLimit > 0, phone: v.phone.trim(), email: v.email.trim(), address: v.address.trim(), taxCode: v.taxCode.trim(), deliveryAddress: v.deliveryAddress.trim(),
          bankAccount: v.bankAccount.trim(), representative: v.representative.trim(), ...(num(v.sortOrder) !== undefined ? { sortOrder: num(v.sortOrder) } : {}),
          ...(num(v.openingDebt) ? { openingDebt: num(v.openingDebt) } : {}), note: "", isActive: true,
        },
      });
      idem.reset();
      const name = v.name.trim(), phone = v.phone.trim(), address = v.address.trim(), taxCode = v.taxCode.trim(), deliveryAddress = v.deliveryAddress.trim();
      onCreated({ value: r.id, label: `${r.code} — ${name}`, ...(phone ? { hint: phone } : {}), ...(address ? { address } : {}), ...(taxCode ? { taxCode } : {}), ...(deliveryAddress ? { deliveryAddress } : {}) });
      setOpen(false); setV(EMPTY); setAlsoSupplier(false); setIsExpense(false);
    } catch (e) {
      if (e instanceof ApiError && e.fields && Object.keys(e.fields).length) { setFieldErrors(e.fields); setError(e.message); }
      else setError(e instanceof Error ? e.message : `Không tạo được ${noun}.`);
    } finally { setBusy(false); }
  }

  const err = (k: string) => fieldErrors[k] || undefined;
  const text = (k: keyof typeof EMPTY, label: string, extra: { required?: boolean; mode?: "numeric" | "decimal" | "tel" | "email"; placeholder?: string; wide?: boolean } = {}) => (
    <InlineField id={`qc-${k}`} label={label} required={extra.required} error={err(k)} labelClass={LABEL} className={extra.wide ? "sm:col-span-2" : undefined}>
      <input id={`qc-${k}`} value={v[k]} onChange={set(k)} inputMode={extra.mode} placeholder={extra.placeholder} autoComplete="off" aria-invalid={!!err(k)} aria-describedby={err(k) ? `qc-${k}-error` : undefined} className={igInput} />
    </InlineField>
  );

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setError(null); setFieldErrors({}); } }}>
      <Dialog.Trigger asChild>
        <button type="button" className="inline-flex h-11 shrink-0 items-center gap-1 rounded-sm border border-accent px-3 text-sm font-medium text-accent hover:bg-accent-soft md:h-10"><UserPlus size={16} aria-hidden /> Thêm {noun}</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        {/* Không dùng <form>: dialog nằm trong form lập đơn (portal vẫn nổi bọt sự kiện React) */}
        <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog flex max-h-[92dvh] w-[calc(100%-1rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-raised shadow-lg">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Dialog.Title className="flex items-center gap-2 text-lg font-semibold"><UserPlus size={20} aria-hidden className="text-accent" /> Thêm mới {noun}</Dialog.Title>
            <Dialog.Close asChild><button type="button" aria-label="Đóng" className="flex h-10 w-10 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg"><X size={18} aria-hidden /></button></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Nhập thông tin {noun}. Mã để trống thì hệ thống tự cấp.</Dialog.Description>
          <div className="min-h-0 flex-1 overflow-y-auto border-y border-border bg-canvas px-4 py-4" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); void save(); } }}>
            <h3 className="mb-3 text-sm font-semibold">Thông tin {noun}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {text("name", `Tên ${noun}`, { required: true, wide: true })}
              {text("code", `Mã ${noun}`, { placeholder: "Để trống để tự cấp" })}
              {text("phone", "Số điện thoại", { mode: "tel" })}
              {text("email", "Email", { mode: "email" })}
              {text("address", "Địa chỉ")}
              {text("taxCode", "Mã số thuế", { mode: "numeric" })}
              {text("bankAccount", "TK ngân hàng")}
              {text("representative", "Người đại diện")}
              {text("sortOrder", "Thứ tự", { mode: "numeric" })}
              {text("openingDebt", "Công nợ đầu kỳ", { mode: "decimal", placeholder: "+ khách nợ, − mình nợ" })}
              {text("debtLimit", "Hạn mức công nợ", { mode: "decimal" })}
              {text("deliveryAddress", "Địa chỉ giao hàng")}
            </div>
            <fieldset className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
              <legend className="sr-only">Loại đối tác</legend>
              <span className="font-medium text-fg-secondary">Loại đối tác:</span>
              <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={kind !== "supplier"} disabled className="h-4 w-4" />Khách hàng</label>
              <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={kind === "supplier" || alsoSupplier} disabled={kind === "supplier"} onChange={(e) => setAlsoSupplier(e.target.checked)} className="h-4 w-4" />Nhà cung cấp</label>
              <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={isExpense} onChange={(e) => setIsExpense(e.target.checked)} className="h-4 w-4" />Chi phí</label>
            </fieldset>
            <div className="mt-3 max-w-md">
              <InlineField id="qc-group" label={`Nhóm ${noun === "nhà cung cấp" ? "đối tác" : noun}`} required error={err("groupId")} labelClass="sm:min-w-44">
                <select id="qc-group" value={groupId} onChange={(e) => setGroupId(e.target.value)} className={`${igInput} cursor-pointer`}>
                  {groups.length === 0 && <option value="">Chưa có nhóm</option>}
                  {groups.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </InlineField>
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          </div>
          <div className="flex items-center justify-end gap-3 px-4 py-3">
            <Dialog.Close asChild><button type="button" className="h-11 rounded-sm px-4 text-sm font-medium text-fg-secondary hover:bg-hover md:h-10">Huỷ bỏ</button></Dialog.Close>
            <button type="button" onClick={() => void save()} disabled={busy} className="h-11 min-w-28 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60 md:h-10">{busy ? "Đang lưu" : "Thêm mới"}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
