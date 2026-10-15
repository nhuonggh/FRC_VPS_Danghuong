"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatQty } from "@/lib/format";
import type { ClosePreview } from "@/server/period/close";

interface CloseResult { closedPeriodId: number; newPeriod: { id: number; name: string }; carried: { stockLots: number; draftOrders: number; quotes: number } }

const card = "rounded-md border border-border bg-surface p-4";

function PreviewGrid({ preview, cashNames }: { preview: ClosePreview; cashNames: Record<number, string> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className={card}>
        <p className="text-xs font-semibold text-fg-secondary">Tồn kho chuyển sang</p>
        <p className="tabular mt-1 text-lg font-bold">{formatCurrency(preview.stock.value)}</p>
        <p className="text-xs text-fg-secondary">{preview.stock.lots} lô · {preview.stock.products} mã · {formatQty(preview.stock.qty)} (ĐV gốc)</p>
        <p className="mt-1 text-xs text-fg-muted">Giữ nguyên từng lô, không đổi giá vốn.</p>
      </div>
      <div className={card}>
        <p className="text-xs font-semibold text-fg-secondary">Công nợ phải thu</p>
        <p className="tabular mt-1 text-lg font-bold">{formatCurrency(preview.receivable.total)}</p>
        <p className="text-xs text-fg-secondary">{preview.receivable.partners} đối tác còn nợ</p>
      </div>
      <div className={card}>
        <p className="text-xs font-semibold text-fg-secondary">Công nợ phải trả</p>
        <p className="tabular mt-1 text-lg font-bold">{formatCurrency(preview.payable.total)}</p>
        <p className="text-xs text-fg-secondary">{preview.payable.partners} đối tác</p>
        <p className="mt-1 text-xs text-fg-muted">Chiết khấu tích lũy: {formatCurrency(preview.discount.total)} ({preview.discount.partners} khách)</p>
      </div>
      <div className={card}>
        <p className="text-xs font-semibold text-fg-secondary">Số dư quỹ / ngân hàng</p>
        {preview.cash.length === 0 ? <p className="mt-1 text-sm text-fg-muted">Không có số dư.</p> : (
          <ul className="mt-1 space-y-0.5 text-sm">
            {preview.cash.map((c) => <li key={c.accountId} className="flex justify-between gap-2"><span className="truncate">{cashNames[c.accountId] ?? `Quỹ #${c.accountId}`}</span><span className="tabular font-semibold">{formatCurrency(c.balance)}</span></li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Khối kết sổ: bước 1 xem trước số đầu kỳ mới; bước 2 (hộp thoại) gõ lại tên kỳ + khai sao lưu + tick xác nhận. */
export function ClosePanel({ periodName, blockerCount, warningCount, preview, cashNames }: {
  periodName: string; blockerCount: number; warningCount: number; preview: ClosePreview | null; cashNames: Record<number, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [backupAt, setBackupAt] = useState("");
  const [ack, setAck] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<CloseResult | null>(null);
  const ready = name.trim() === periodName && backupAt !== "" && ack;

  async function submit() {
    if (busy || !ready) return;
    setBusy(true); setError(null); setFields({});
    try {
      const result = await apiFetch<CloseResult>("/api/period/close", {
        method: "POST",
        json: { confirmName: name.trim(), backupAt: new Date(backupAt).toISOString(), acknowledged: ack, ...(newName.trim() ? { newName: newName.trim() } : {}) },
      });
      setDone(result); setOpen(false); router.refresh();
    } catch (cause) {
      if (cause instanceof ApiError) { setError(cause.message); setFields(cause.fields ?? {}); }
      else setError("Không kết sổ được, vui lòng thử lại.");
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <section role="status" className="rounded-md border border-success bg-success-soft p-5">
        <h2 className="text-base font-semibold text-success">Đã kết sổ {periodName}</h2>
        <p className="mt-1 text-sm">Kỳ mới <strong>{done.newPeriod.name}</strong> đã mở: {done.carried.stockLots} lô tồn, {done.carried.draftOrders} đơn nháp và {done.carried.quotes} báo giá được mang sang. Số đầu kỳ = số cuối kỳ cũ.</p>
        <Link href="/" className="mt-3 inline-flex h-10 items-center rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent hover:bg-accent-600">Về trang chủ</Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="close-action" className="space-y-4">
      <h2 id="close-action" className="border-b border-border pb-3 text-base font-semibold">Kết sổ</h2>
      {blockerCount > 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-fg-secondary">Còn {blockerCount} mục chặn ở trên. Xử lý hết rồi mới kết sổ được.</p>
      ) : (
        <>
          {preview && (<><p className="text-sm text-fg-secondary">Bước 1 — xem trước. Các số dưới đây sẽ thành <strong>số đầu kỳ mới</strong> (bằng đúng số cuối kỳ này):</p><PreviewGrid preview={preview} cashNames={cashNames} /></>)}
          {warningCount > 0 && <p className="text-sm text-warning">Còn {warningCount} cảnh báo ở trên — không chặn, nhưng hãy xem trước khi kết.</p>}
          <button type="button" onClick={() => setOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-sm bg-danger px-4 text-sm font-semibold text-fg-on-accent md:h-10">
            <Lock size={16} aria-hidden />Kết sổ {periodName}…
          </button>
        </>
      )}

      <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-raised p-5 shadow-lg">
            <Dialog.Title className="text-base font-semibold">Xác nhận kết sổ {periodName}</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-fg-secondary">
              Bước 2. Kỳ đóng <strong>không mở lại và không sửa/hủy chứng từ</strong> được nữa; mọi điều chỉnh sau này đi bằng chứng từ mới ở kỳ mới.
            </Dialog.Description>

            <label htmlFor="close-backup" className="mt-4 block text-xs font-semibold text-fg-secondary">Thời điểm sao lưu DB gần nhất (trong 24 giờ qua)</label>
            <input id="close-backup" type="datetime-local" value={backupAt} onChange={(e) => setBackupAt(e.target.value)} aria-invalid={!!fields.backupAt} className="mt-1 h-10 w-full rounded-sm border border-border bg-canvas px-3 text-sm" />
            {fields.backupAt ? <p role="alert" className="mt-1 text-xs text-danger">{fields.backupAt}</p> : <p className="mt-1 text-xs text-fg-muted">Chạy <code>~/bin/backup.sh</code> trên VPS (RUNBOOK mục 14) rồi nhập giờ file vừa tạo. Giờ này được ghi vào nhật ký.</p>}

            <label htmlFor="close-new-name" className="mt-4 block text-xs font-semibold text-fg-secondary">Tên kỳ mới (tùy chọn)</label>
            <input id="close-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} placeholder="Mặc định: Kỳ MM/YYYY" className="mt-1 h-10 w-full rounded-sm border border-border bg-canvas px-3 text-sm" />

            <label htmlFor="close-confirm" className="mt-4 block text-xs font-semibold text-fg-secondary">Gõ lại đúng tên kỳ: <span className="font-bold text-fg">{periodName}</span></label>
            <input id="close-confirm" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" aria-invalid={!!fields.confirmName} className="mt-1 h-10 w-full rounded-sm border border-border bg-canvas px-3 text-sm" />
            {fields.confirmName && <p role="alert" className="mt-1 text-xs text-danger">{fields.confirmName}</p>}

            <label className="mt-4 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>Tôi đã hiểu kết sổ không hoàn tác được và đã có bản sao lưu DB mới.</span>
            </label>
            {error && !fields.backupAt && !fields.confirmName && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover disabled:opacity-50 md:h-10">Hủy</button>
              <button type="button" onClick={() => void submit()} disabled={!ready || busy} className="h-11 rounded-sm bg-danger px-4 text-sm font-semibold text-fg-on-accent disabled:opacity-50 md:h-10">{busy ? "Đang kết sổ…" : "Kết sổ"}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
