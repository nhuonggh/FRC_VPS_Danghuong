"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";

/** Khôi phục đơn đã hủy: xuất kho lại tại vị trí thời gian gốc (thiếu tồn ⇒ đơn treo). */
export function RestoreButton({ orderId, code }: { orderId: number; code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function restore() {
    if (busy) return;
    const ok = await confirm({ title: `Khôi phục đơn ${code}?`, description: "Đơn được xuất kho lại theo FIFO tại vị trí ngày gốc. Nếu thiếu tồn, đơn sẽ thành đơn treo.", confirmLabel: "Khôi phục" });
    if (!ok) return;
    setBusy(true);
    try { await apiFetch(`/api/orders/${orderId}/restore`, { method: "POST" }); router.refresh(); } finally { setBusy(false); }
  }
  return (
    <button type="button" onClick={restore} disabled={busy} aria-label={`Khôi phục đơn ${code}`}
      className="inline-flex h-9 items-center gap-1 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover disabled:opacity-50">
      <RotateCcw size={14} aria-hidden />Khôi phục
    </button>
  );
}
