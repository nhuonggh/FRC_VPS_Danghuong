"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";

/** Khôi phục đơn đã hủy: xuất kho lại tại vị trí thời gian gốc (thiếu tồn ⇒ đơn treo). */
export function RestoreButton({ orderId, code, iconOnly = false }: { orderId: number; code: string; iconOnly?: boolean }) {
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
    <button type="button" onClick={restore} disabled={busy} aria-label={`Khôi phục đơn ${code}`} title={`Khôi phục đơn ${code}`}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 md:min-h-9 md:min-w-9">
      <RotateCcw size={16} aria-hidden />{!iconOnly && "Khôi phục"}
    </button>
  );
}
