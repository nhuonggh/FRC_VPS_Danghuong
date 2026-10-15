"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { InlineField, igInput } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";

/** Nút "+" cạnh ô chọn: thêm nhanh một mục danh mục (nhóm hàng, đơn vị tính…) không phải rời form. Cần quyền `catalog.manage` (ẩn nếu không có). */
export function QuickCatalogAdd({ section, label, maxLength = 60, onAdded }: { section: "product-groups" | "units"; label: string; maxLength?: number; onAdded: (item: { value: number; label: string }) => void }) {
  const idem = useIdempotencyKey();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const value = name.trim();
    if (busy) return;
    if (!value) { setError(`Nhập ${label.toLowerCase()}.`); return; }
    setBusy(true); setError(null);
    try {
      const r = await apiFetch<{ id: number }>(`/api/catalog/${section}`, { method: "POST", json: { name: value }, idempotencyKey: idem.key });
      idem.reset(); onAdded({ value: r.id, label: value }); setOpen(false); setName("");
    } catch (e) { setError(e instanceof ApiError && e.fields?.name ? e.fields.name : e instanceof Error ? e.message : "Không thêm được."); } finally { setBusy(false); }
  }
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <Dialog.Trigger asChild><button type="button" aria-label={`Thêm ${label.toLowerCase()}`} title={`Thêm ${label.toLowerCase()}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-accent text-fg-on-accent md:h-9 md:w-9"><Plus size={18} aria-hidden /></button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        {/* Không dùng <form>: nằm trong form sản phẩm (portal vẫn nổi bọt sự kiện React) */}
        <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog w-[calc(100%-1rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-raised shadow-lg">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Dialog.Title className="text-lg font-semibold">Thêm {label.toLowerCase()}</Dialog.Title>
            <Dialog.Close asChild><button type="button" aria-label="Đóng" className="flex h-10 w-10 items-center justify-center rounded-sm text-fg-muted hover:bg-hover"><X size={18} aria-hidden /></button></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Nhập tên {label.toLowerCase()} mới.</Dialog.Description>
          <div className="space-y-2 border-y border-border bg-canvas px-4 py-4" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}>
            <InlineField id="qca-name" label={label} required error={error ?? undefined}><input id="qca-name" value={name} maxLength={maxLength} autoFocus autoComplete="off" onChange={(e) => { setName(e.target.value); setError(null); }} className={igInput} /></InlineField>
          </div>
          <div className="flex justify-end gap-3 px-4 py-3">
            <Dialog.Close asChild><button type="button" className="h-11 rounded-sm px-4 text-sm font-medium text-fg-secondary hover:bg-hover md:h-10">Huỷ bỏ</button></Dialog.Close>
            <button type="button" onClick={() => void save()} disabled={busy} className="h-11 min-w-24 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60 md:h-10">{busy ? "Đang lưu" : "Thêm mới"}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
