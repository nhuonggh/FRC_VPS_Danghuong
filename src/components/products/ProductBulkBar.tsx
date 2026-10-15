"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass } from "@/components/ui";
import { toastApiError } from "@/lib/api-error-toast";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "@/lib/toast";

type Mode = "link" | "unlink";

/**
 * Thanh thao tác hàng loạt của danh sách sản phẩm: tick nhiều sản phẩm (hoặc "chọn tất cả N kết quả theo bộ lọc")
 * rồi Gắn / Bỏ một kiểu gia công. Tỷ lệ m²/md để trống ⇒ sản phẩm dùng mặc định của kiểu (không ghi đè tỷ lệ riêng đã có).
 */
export function ProductBulkBar({ selectedIds, total, filterQuery, processingTypes, onClear, onSelectAll, allMatching }: {
  selectedIds: number[]; total: number; filterQuery: string; processingTypes: { value: number; label: string }[];
  onClear: () => void; onSelectAll: (on: boolean) => void; allMatching: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [typeId, setTypeId] = useState("");
  const [ratio, setRatio] = useState("");
  const [busy, setBusy] = useState(false);
  const count = allMatching ? total : selectedIds.length;
  if (selectedIds.length === 0 && !allMatching) return null;

  const close = () => { if (!busy) { setMode(null); setTypeId(""); setRatio(""); } };
  async function submit() {
    if (!mode || !typeId) return;
    const text = ratio.trim().replace(",", ".");
    if (mode === "link" && text !== "" && !(Number(text) > 0)) { toast.error("Tỷ lệ phải là số lớn hơn 0."); return; }
    setBusy(true);
    try {
      const res = await apiFetch<{ selected: number; changed: number }>("/api/products/bulk-processing", {
        method: "POST",
        json: { action: mode, processingTypeId: Number(typeId), ratio: mode === "link" && text !== "" ? Number(text) : null, ...(allMatching ? { filter: filterQuery } : { ids: selectedIds }) },
      });
      toast.success(mode === "link" ? `Đã gắn kiểu gia công cho ${res.changed}/${res.selected} sản phẩm.` : `Đã bỏ kiểu gia công khỏi ${res.changed}/${res.selected} sản phẩm.`);
      setMode(null); setTypeId(""); setRatio(""); onClear(); router.refresh();
    } catch (e) { toastApiError(e); } finally { setBusy(false); }
  }

  const btn = "h-10 rounded-sm border border-border bg-canvas px-3 text-sm font-medium hover:bg-hover";
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-sm border border-accent bg-accent-soft px-3 py-2 text-sm" role="region" aria-label="Thao tác hàng loạt">
      <b>Đã chọn {count} sản phẩm</b>
      {!allMatching && total > selectedIds.length && <button type="button" onClick={() => onSelectAll(true)} className="text-accent underline">Chọn tất cả {total} sản phẩm theo bộ lọc</button>}
      {allMatching && <button type="button" onClick={() => onSelectAll(false)} className="text-accent underline">Chỉ giữ các dòng đã tick</button>}
      <span className="ml-auto flex flex-wrap gap-2">
        <button type="button" onClick={() => setMode("link")} className={btn}>Gắn kiểu gia công…</button>
        <button type="button" onClick={() => setMode("unlink")} className={btn}>Bỏ kiểu gia công…</button>
        <button type="button" onClick={onClear} className={btn}>Bỏ chọn</button>
      </span>
      <Dialog.Root open={mode !== null} onOpenChange={(o) => { if (!o) close(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-raised p-5 shadow-lg">
            <Dialog.Title className="text-base font-semibold">{mode === "link" ? "Gắn kiểu gia công" : "Bỏ kiểu gia công"} cho {count} sản phẩm</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-fg-secondary">
              {mode === "link" ? "Sau khi gắn, kiểu này hiện ở màn bán hàng của các sản phẩm đã chọn." : "Chỉ bỏ liên kết với sản phẩm; định mức và đơn đã lập không đổi."}
            </Dialog.Description>
            <label htmlFor="bulk-type" className="mt-4 block text-xs text-fg-muted">Kiểu gia công</label>
            <select id="bulk-type" value={typeId} onChange={(e) => setTypeId(e.target.value)} className={`${inputClass()} mt-1 w-full cursor-pointer`}>
              <option value="">— Chọn kiểu gia công —</option>
              {processingTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {mode === "link" && (<>
              <label htmlFor="bulk-ratio" className="mt-3 block text-xs text-fg-muted">Tỷ lệ m²/md (tuỳ chọn)</label>
              <input id="bulk-ratio" inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder="Để trống = dùng mặc định của kiểu" className={`${inputClass()} mt-1 w-full tabular`} />
              <p className="mt-1 text-xs text-fg-muted">Nhập số thì đặt tỷ lệ này cho mọi sản phẩm đã chọn (ghi đè tỷ lệ riêng đã có).</p>
            </>)}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={close} disabled={busy} className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover disabled:opacity-50 md:h-10">Đóng</button>
              <button type="button" onClick={() => void submit()} disabled={busy || !typeId} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50 md:h-10">{busy ? "Đang xử lý…" : mode === "link" ? "Gắn" : "Bỏ"}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
