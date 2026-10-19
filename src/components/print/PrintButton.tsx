"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { hasLocalPrint, localPrintHref } from "@/lib/local-print";

/**
 * Three HTML forms open directly from the click. Other document types retain the Apps Script flow.
 */
export function PrintButton({ docType, docId, label = "In", className }: { docType: string; docId: number; label?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<{ url: string; name: string; replaced: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (hasLocalPrint(docType)) return <a href={localPrintHref(docType, docId)} target="_blank" rel="noopener noreferrer" className={className ?? "inline-flex min-h-11 items-center gap-2 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover focus-visible:outline-accent"}><Printer size={16} aria-hidden />{label}</a>;

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
