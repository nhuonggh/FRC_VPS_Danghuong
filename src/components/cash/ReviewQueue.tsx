"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, ReasonDialog } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDate } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { QueueRowDTO } from "@/server/cash/queries";

const TONE = { PENDING_REVIEW: "warning", RETURNED: "danger", REVIEWED: "success", ADJUST_REQUESTED: "info" } as const;
const KIND = { RECEIPT: "receipts", PAYMENT: "payments" } as const;

/** Hàng chờ của thủ quỹ: kiểm tra / trả lại phiếu, duyệt / từ chối điều chỉnh ngay trong danh sách. */
export function ReviewQueue({ rows, canApprove }: { rows: QueueRowDTO[]; canApprove: boolean }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ row: QueueRowDTO; mode: "return" | "reject" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(row: QueueRowDTO, fn: () => Promise<unknown>) {
    if (busy) return; setBusy(row.key); setError(null);
    try { await fn(); idem.reset(); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Không thực hiện được."); } finally { setBusy(null); }
  }
  const review = (r: QueueRowDTO) => act(r, () => apiFetch(`/api/vouchers/${KIND[r.doc]}/${r.id}/review`, { method: "POST", idempotencyKey: `${idem.key}-${r.key}` }));
  const approve = (r: QueueRowDTO) => act(r, () => apiFetch(`/api/cash/adjustments/${r.adjustmentId}`, { method: "POST", json: { approve: true, note: "" }, idempotencyKey: `${idem.key}-${r.key}` }));

  return (
    <>
      {error && <p role="alert" className="border-b border-border bg-danger-soft p-2 text-sm text-danger">{error}</p>}
      <table className="w-full min-w-[900px] text-sm">
        <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
          <th className="px-3 py-2">Mã</th><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Nội dung</th><th className="px-3 py-2">Đối tác</th><th className="px-3 py-2 text-right">Số tiền</th><th className="px-3 py-2">Trạng thái</th><th className="px-3 py-2">Người lập</th><th className="px-3 py-2 text-right">Thao tác</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border align-top">
              <td className="px-3 py-2 font-mono text-xs"><Link href={`/accounting/${KIND[r.doc]}/${r.id}`} className="text-accent hover:underline">{r.code}</Link></td>
              <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.at)}</td>
              <td className="px-3 py-2">{r.label}{r.detail && <span className="block text-xs text-fg-muted">{r.detail}</span>}</td>
              <td className="px-3 py-2">{r.partnerName}</td>
              <td className="px-3 py-2 text-right tabular">{formatCurrency(r.amount)}</td>
              <td className="px-3 py-2"><Badge tone={TONE[r.status]}>{r.statusLabel}</Badge></td>
              <td className="px-3 py-2">{r.createdByName}</td>
              <td className="px-3 py-2 text-right">
                <div className="flex justify-end gap-2">
                  {r.kind !== "ADJUSTMENT" && r.status === "PENDING_REVIEW" && (<>
                    <button type="button" disabled={busy !== null} onClick={() => review(r)} aria-label={`Kiểm tra ${r.code}`} className="h-9 rounded-sm bg-accent px-3 text-sm font-medium text-fg-on-accent disabled:opacity-50">Kiểm tra</button>
                    <button type="button" disabled={busy !== null} onClick={() => setDialog({ row: r, mode: "return" })} aria-label={`Trả lại ${r.code}`} className="h-9 rounded-sm border border-border px-3 text-sm hover:bg-hover disabled:opacity-50">Trả lại</button>
                  </>)}
                  {r.kind === "ADJUSTMENT" && canApprove && (<>
                    <button type="button" disabled={busy !== null} onClick={() => approve(r)} aria-label={`Duyệt điều chỉnh ${r.code}`} className="h-9 rounded-sm bg-accent px-3 text-sm font-medium text-fg-on-accent disabled:opacity-50">Duyệt</button>
                    <button type="button" disabled={busy !== null} onClick={() => setDialog({ row: r, mode: "reject" })} aria-label={`Từ chối điều chỉnh ${r.code}`} className="h-9 rounded-sm border border-danger px-3 text-sm text-danger hover:bg-danger-soft disabled:opacity-50">Từ chối</button>
                  </>)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ReasonDialog open={dialog !== null} onClose={() => setDialog(null)} confirmLabel={dialog?.mode === "reject" ? "Từ chối" : "Trả lại"}
        title={dialog ? `${dialog.mode === "reject" ? "Từ chối điều chỉnh" : "Trả lại phiếu"} ${dialog.row.code}?` : ""}
        description={dialog?.mode === "reject" ? undefined : "Phiếu về “Bị trả lại” để kế toán sửa và gửi lại. Sổ quỹ và công nợ không đổi."}
        onConfirm={async (reason) => {
          const r = dialog!.row;
          if (dialog!.mode === "return") await apiFetch(`/api/vouchers/${KIND[r.doc]}/${r.id}/return`, { method: "POST", json: { reason }, idempotencyKey: `${idem.key}-${r.key}` });
          else await apiFetch(`/api/cash/adjustments/${r.adjustmentId}`, { method: "POST", json: { approve: false, note: reason }, idempotencyKey: `${idem.key}-${r.key}` });
          idem.reset(); router.refresh();
        }} />
    </>
  );
}
