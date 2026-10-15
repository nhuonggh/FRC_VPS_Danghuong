"use client";

import { Download } from "lucide-react";
import { useState } from "react";

export function ReportExportButton({ href, label = "Xuất báo cáo" }: { href: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(href);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? (typeof body?.error === "string" ? body.error : body?.error?.message) ?? "Không xuất được báo cáo. Vui lòng thử lại.");
      }
      if (!response.headers.get("content-type")?.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) throw new Error("Phiên đăng nhập có thể đã hết hạn. Vui lòng tải lại trang rồi xuất báo cáo.");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      const filename = response.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      a.download = filename ? decodeURIComponent(filename) : "bao-cao.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : "Không xuất được báo cáo."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-1"><button type="button" onClick={download} disabled={busy} aria-busy={busy} className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm font-medium hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"><Download size={16} aria-hidden />{busy ? "Đang xuất…" : label}</button>{error && <p role="alert" className="max-w-sm text-sm text-danger">{error}</p>}</div>;
}
