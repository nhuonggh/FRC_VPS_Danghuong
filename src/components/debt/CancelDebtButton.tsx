"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ReasonDialog } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";

/** Hủy phiếu điều chỉnh / phiếu chuyển-gộp: bắt buộc lý do. */
export function CancelDebtButton({ kind, id, code }: { kind: "adjustments" | "transfers"; id: number; code: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  async function cancel(reason: string) { await apiFetch(`/api/debts/${kind}/${id}/cancel`, { method: "POST", json: { reason } }); router.refresh(); }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Hủy phiếu ${code}`} className="h-9 rounded-sm border border-danger px-3 text-sm text-danger hover:bg-danger-soft">Hủy phiếu</button>
      <ReasonDialog open={open} onClose={() => setOpen(false)} title={`Hủy phiếu ${code}?`}
        description={kind === "adjustments" ? "Công nợ (và chiết khấu tích lũy nếu có) trở về như trước khi điều chỉnh." : "Công nợ hai bên trở về như trước; nếu là phiếu gộp mã thì mã đã gộp được mở lại."} confirmLabel="Hủy phiếu" onConfirm={cancel} />
    </>
  );
}
