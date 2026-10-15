"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";

/**
 * Nút In (D-38): tạo bản in qua Apps Script (vài giây) — KHÔNG khoá màn hình, chỉ nút này bận. Xong hiện liên kết mở bản in (Google Doc);
 * in lại thay bản cũ. Lỗi hiện ngay cạnh nút (chưa cấu hình mẫu, Google không phản hồi trong 12 giây…).
 */
export function PrintButton({ docType, docId, label = "In", className }: { docType: string; docId: number; label?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<{ url: string; name: string; replaced: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function print() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await apiFetch<{ url: string; name: string; replaced: boolean }>(`/api/print/${docType}/${docId}`, { method: "POST" });
      setFile(r);
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e) { setError(e instanceof Error ? e.message : "Không tạo được bản in."); } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={print} disabled={busy} aria-busy={busy} className={className ?? "flex h-10 items-center gap-2 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover disabled:opacity-60"}>
        <Printer size={16} aria-hidden />{busy ? "Đang tạo bản in…" : file ? "In lại" : label}
      </button>
      {file && <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-accent hover:underline">Mở bản in{file.replaced ? " (đã thay bản cũ)" : ""}</a>}
      {error && <span role="alert" className="max-w-md text-xs text-danger">{error}</span>}
    </span>
  );
}
