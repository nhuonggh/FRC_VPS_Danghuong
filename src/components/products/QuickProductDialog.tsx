"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { PackagePlus, X } from "lucide-react";
import { useState } from "react";
import { igInput, InlineField, NumberInput, type ComboOption } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { BASE_UNIT_SUGGESTIONS, PRODUCT_KINDS } from "@/server/products/schemas";
import type { ProductOption } from "@/server/products/queries";

export type QuickProductConfig = { groups: ComboOption[]; units: string[]; canSeePurchase: boolean };

import { PRODUCT_CAPABILITIES, defaultCapabilities } from "@/server/products/capabilities";
const EMPTY = { code: "", name: "", baseUnit: "", kind: "HANG", groupId: "", minStock: "", purchasePrice: "", note: "" };
const LABEL = "sm:min-w-40";

/** Hộp thoại thêm sản phẩm ngay trong phiếu nhập (cùng kiểu hộp thoại thêm nhà cung cấp). Cần quyền `product.manage`. Đơn vị quy đổi/kiểu gia công bổ sung sau ở chi tiết sản phẩm. */
export function QuickProductDialog({ config, onCreated, defaultKind = "HANG", triggerLabel = "Thêm sản phẩm" }: { config: QuickProductConfig; onCreated: (p: ProductOption) => void; defaultKind?: (typeof PRODUCT_KINDS)[number]["value"]; triggerLabel?: string }) {
  const idem = useIdempotencyKey();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ ...EMPTY, kind: defaultKind });
  const [capabilities, setCapabilities] = useState(() => defaultCapabilities(defaultKind));
  const [isCoil, setIsCoil] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setV((s) => ({ ...s, [k]: e.target.value })); setFieldErrors((f) => (f[k] ? { ...f, [k]: "" } : f)); };
  const units = [...new Set([...config.units, ...BASE_UNIT_SUGGESTIONS])];

  async function save() {
    if (busy) return;
    const errs: Record<string, string> = {};
    if (!v.code.trim()) errs.code = "Nhập mã sản phẩm.";
    else if (!/^[A-Za-z0-9._\-/]+$/.test(v.code.trim())) errs.code = "Mã chỉ gồm chữ không dấu, số và . _ - /.";
    if (!v.name.trim()) errs.name = "Nhập tên sản phẩm.";
    if (!v.baseUnit.trim()) errs.baseUnit = "Nhập đơn vị gốc.";
    else if (v.baseUnit.trim().length > 10) errs.baseUnit = "Đơn vị tối đa 10 ký tự.";
    if (Object.keys(errs).length) { setFieldErrors(errs); setError("Vui lòng nhập các trường bắt buộc (*) và sửa ô báo lỗi."); return; }
    setBusy(true); setError(null); setFieldErrors({});
    const price = v.purchasePrice.trim() === "" ? null : Number(v.purchasePrice);
    try {
      const r = await apiFetch<{ id: number }>("/api/products", {
        method: "POST", idempotencyKey: idem.key,
        json: {
          ...capabilities, code: v.code.trim(), name: v.name.trim(), kind: v.kind, baseUnit: v.baseUnit.trim(), minStock: Number(v.minStock) || 0, isCoil, isActive: true, note: v.note.trim(),
          groupId: v.groupId ? Number(v.groupId) : null, imageUrl: "", importUnit: "", exportUnit: "", bundleQty: null, qtyLabel: "", units: [],
          ...(config.canSeePurchase ? { purchasePrice: price, salePrice: null } : {}),
        },
      });
      idem.reset();
      const baseUnit = v.baseUnit.trim();
      onCreated({ value: r.id, label: `${v.code.trim()} — ${v.name.trim()}`, hint: baseUnit, baseUnit, units: [{ unit: baseUnit, factor: "1" }] });
      setOpen(false); setV({ ...EMPTY, kind: defaultKind }); setIsCoil(false); setCapabilities(defaultCapabilities(defaultKind));
    } catch (e) {
      if (e instanceof ApiError && e.fields && Object.keys(e.fields).length) { setFieldErrors(e.fields); setError(e.message); }
      else setError(e instanceof Error ? e.message : "Không tạo được sản phẩm.");
    } finally { setBusy(false); }
  }

  const err = (k: string) => fieldErrors[k] || undefined;
  const text = (k: "code" | "name" | "baseUnit", label: string, extra: { required?: boolean; wide?: boolean; list?: string; placeholder?: string } = {}) => (
    <InlineField id={`qp-${k}`} label={label} required={extra.required} error={err(k)} labelClass={LABEL} className={extra.wide ? "sm:col-span-2" : undefined}>
      <input id={`qp-${k}`} value={v[k]} onChange={set(k)} list={extra.list} placeholder={extra.placeholder} autoComplete="off" aria-invalid={!!err(k)} aria-describedby={err(k) ? `qp-${k}-error` : undefined} className={igInput} />
    </InlineField>
  );

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setError(null); setFieldErrors({}); } }}>
      <Dialog.Trigger asChild>
        <button type="button" className="inline-flex h-11 shrink-0 items-center gap-1 rounded-sm border border-accent px-4 text-sm font-medium text-accent hover:bg-accent-soft md:h-10"><PackagePlus size={16} aria-hidden /> {triggerLabel}</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        {/* Không dùng <form>: dialog nằm trong form phiếu nhập (portal vẫn nổi bọt sự kiện React) */}
        <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog flex max-h-[92dvh] w-[calc(100%-1rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-raised shadow-lg">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Dialog.Title className="flex items-center gap-2 text-lg font-semibold"><PackagePlus size={20} aria-hidden className="text-accent" /> Thêm mới sản phẩm</Dialog.Title>
            <Dialog.Close asChild><button type="button" aria-label="Đóng" className="flex h-10 w-10 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg"><X size={18} aria-hidden /></button></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Nhập thông tin sản phẩm. Đơn vị quy đổi và kiểu gia công bổ sung sau ở chi tiết sản phẩm.</Dialog.Description>
          <div className="min-h-0 flex-1 overflow-y-auto border-y border-border bg-canvas px-4 py-4" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); void save(); } }}>
            <h3 className="mb-3 text-sm font-semibold">Thông tin sản phẩm</h3>
            <datalist id="qp-unit-options">{units.map((u) => <option key={u} value={u} />)}</datalist>
            <div className="grid gap-3 sm:grid-cols-2">
              {text("name", "Tên sản phẩm", { required: true, wide: true })}
              {text("code", "Mã sản phẩm", { required: true })}
              {text("baseUnit", "Đơn vị gốc", { required: true, list: "qp-unit-options", placeholder: "md, kg, cái…" })}
              <InlineField id="qp-group" label="Nhóm sản phẩm" labelClass={LABEL}>
                <select id="qp-group" value={v.groupId} onChange={set("groupId")} className={`${igInput} cursor-pointer`}>
                  <option value="">Chưa phân nhóm</option>
                  {config.groups.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </InlineField>
              <InlineField id="qp-kind" label="Loại" labelClass={LABEL}>
                <select id="qp-kind" value={v.kind} onChange={set("kind")} className={`${igInput} cursor-pointer`}>
                  {PRODUCT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </InlineField>
              <InlineField id="qp-minStock" label="Định mức tồn" labelClass={LABEL}><NumberInput id="qp-minStock" maxFrac={3} value={v.minStock} placeholder="0" onValueChange={(val) => setV((s) => ({ ...s, minStock: val }))} className={`${igInput} tabular text-right`} /></InlineField>
              {config.canSeePurchase && <InlineField id="qp-purchasePrice" label="Giá nhập" hint="theo đơn vị gốc" labelClass={LABEL}><NumberInput id="qp-purchasePrice" maxFrac={2} value={v.purchasePrice} placeholder="0" onValueChange={(val) => setV((s) => ({ ...s, purchasePrice: val }))} className={`${igInput} tabular text-right`} /></InlineField>}
            </div>
            <label className="mt-3 flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={isCoil} onChange={(e) => setIsCoil(e.target.checked)} className="h-4 w-4" />Sản phẩm là tôn (tôn cuộn)</label>
            <fieldset className="mt-3 space-y-2"><legend className="text-sm font-medium">Khả năng sử dụng</legend><div className="grid gap-2 sm:grid-cols-2">{PRODUCT_CAPABILITIES.map((c) => <label key={c.value} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={capabilities[c.value]} onChange={(e) => setCapabilities((s) => ({ ...s, [c.value]: e.target.checked }))} />{c.label}</label>)}</div></fieldset>
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
