"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";

export function ReasonDialog({ open, title, description, confirmLabel, onClose, onConfirm }: {
  open: boolean; title: string; description?: string; confirmLabel: string; onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy) return;
    const value = reason.trim();
    if (!value) { setError("Nhập lý do."); return; }
    setBusy(true); setError(null);
    try { await onConfirm(value); setReason(""); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thực hiện được, vui lòng thử lại."); }
    finally { setBusy(false); }
  }
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-raised p-5 shadow-lg">
        <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
        {description && <Dialog.Description className="mt-2 text-sm text-fg-secondary">{description}</Dialog.Description>}
        <label htmlFor="reason-input" className="mt-4 block text-xs text-fg-muted">Lý do</label>
        <textarea id="reason-input" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} aria-invalid={!!error} className="mt-1 w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" />
        {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover disabled:opacity-50 md:h-10">Đóng</button><button type="button" onClick={() => void submit()} disabled={busy} className="h-11 rounded-sm bg-danger px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60 md:h-10">{busy ? "Đang xử lý" : confirmLabel}</button></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
