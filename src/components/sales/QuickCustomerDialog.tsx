"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { Field, inputClass, type ComboOption } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";

export type QuickCustomer = ComboOption & { address?: string; taxCode?: string; deliveryAddress?: string };

/** Dialog tạo nhanh khách hàng (≤ 4 trường): các thông tin còn lại sửa sau ở trang khách hàng. */
export function QuickCustomerDialog({ groups, onCreated, kind = "customer" }: { groups: ComboOption[]; onCreated: (c: QuickCustomer) => void; kind?: "customer" | "supplier" }) {
  const noun = kind === "supplier" ? "nhà cung cấp" : "khách hàng";
  const idem = useIdempotencyKey();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [groupId, setGroupId] = useState<string>(groups[0] ? String(groups[0].value) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    if (!name.trim()) { setError(`Nhập tên ${noun}.`); return; }
    if (!groupId) { setError(`Chọn nhóm ${noun === "nhà cung cấp" ? "đối tác" : noun}.`); return; }
    setBusy(true); setError(null);
    try {
      const r = await apiFetch<{ id: number; code: string }>("/api/partners", {
        method: "POST", idempotencyKey: idem.key,
        json: { code: "", name: name.trim(), groupId: Number(groupId), isCustomer: kind !== "supplier", isSupplier: kind === "supplier", ownerUserId: null, debtLimit: 0, allowCredit: false, phone: phone.trim(), address: address.trim(), taxCode: taxCode.trim(), deliveryAddress: deliveryAddress.trim(), note: "", isActive: true },
      });
      idem.reset();
      onCreated({ value: r.id, label: `${r.code} — ${name.trim()}`, ...(phone.trim() ? { hint: phone.trim() } : {}), ...(address.trim() ? { address: address.trim() } : {}), ...(taxCode.trim() ? { taxCode: taxCode.trim() } : {}), ...(deliveryAddress.trim() ? { deliveryAddress: deliveryAddress.trim() } : {}) });
      setOpen(false); setName(""); setPhone(""); setAddress(""); setTaxCode(""); setDeliveryAddress("");
    } catch (e) { setError(e instanceof Error ? e.message : `Không tạo được ${noun}.`); } finally { setBusy(false); }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <Dialog.Trigger asChild>
        <button type="button" className="inline-flex h-11 shrink-0 items-center gap-1 rounded-sm border border-accent px-3 text-sm font-medium text-accent hover:bg-accent-soft md:h-10"><UserPlus size={16} aria-hidden /> Thêm {noun}</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        {/* Không dùng <form>: dialog nằm trong form lập đơn (portal vẫn nổi bọt sự kiện React) */}
        <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-raised p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">Thêm {noun}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-secondary">Mã tự sinh. Thông tin khác sửa sau ở trang đối tác.</Dialog.Description>
          <div className="mt-4 space-y-3" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}>
            <Field id="qc-name" label={`Tên ${noun}`} required><input id="qc-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass()} /></Field>
            <Field id="qc-phone" label="Số điện thoại"><input id="qc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={inputClass()} /></Field>
            <Field id="qc-address" label="Địa chỉ"><input id="qc-address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass()} /></Field>
            <Field id="qc-tax" label="Mã số thuế"><input id="qc-tax" value={taxCode} onChange={(e) => setTaxCode(e.target.value)} inputMode="numeric" className={inputClass()} /></Field>
            <Field id="qc-ship" label="Địa chỉ giao hàng"><input id="qc-ship" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} className={inputClass()} /></Field>
            <Field id="qc-group" label="Nhóm đối tác" required>
              <select id="qc-group" value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputClass()}>
                {groups.length === 0 && <option value="">Chưa có nhóm</option>}
                {groups.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </Field>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild><button type="button" className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover md:h-10">Hủy</button></Dialog.Close>
            <button type="button" onClick={() => void save()} disabled={busy} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60 md:h-10">{busy ? "Đang lưu" : "Thêm"}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
