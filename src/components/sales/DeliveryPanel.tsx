"use client";

import { PrintButton } from "@/components/print/PrintButton";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { InlineField, igInput, inputClass, NumberInput } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { formatDateTime, formatQty } from "@/lib/format";
import { ictYmd } from "@/lib/time";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { OrderDetailDTO } from "@/server/sales/queries";

const remainingOf = (l: OrderDetailDTO["lines"][number]) => Math.max(0, Number(l.qty) - Number(l.deliveredQty));

/** Tab Giao hàng (mã 37): lập phiếu giao nhiều lần cho một đơn, hủy phiếu. Không xuất kho lần hai (D-25). */
export function DeliveryPanel({ order, today, canDeliver, canPrint = false }: { order: OrderDetailDTO; today: string; canDeliver: boolean; canPrint?: boolean }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = order.lines.filter((l) => remainingOf(l) > 0);
  const canCreate = canDeliver && !order.isCancelled && open.length > 0;

  async function create() {
    if (busy) return;
    const lines = open.flatMap((l) => (Number(qty[l.id]) > 0 ? [{ orderLineId: l.id, qty: Number(qty[l.id]) }] : []));
    if (!lines.length) { setError("Nhập số lượng giao cho ít nhất một dòng."); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch("/api/delivery-notes", { method: "POST", json: { orderId: order.id, date, note, lines }, idempotencyKey: idem.key });
      idem.reset(); setQty({}); setNote(""); router.refresh();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Không lập được phiếu giao.");
    } finally { setBusy(false); }
  }

  async function cancel(id: number, code: string) {
    const ok = await confirm({ title: `Hủy phiếu giao ${code}?`, description: "Công nợ ghi theo phiếu này sẽ được gỡ; số lượng đã giao quay lại phần còn phải giao.", confirmLabel: "Hủy phiếu", danger: true });
    if (!ok) return;
    await apiFetch(`/api/delivery-notes/${id}/cancel`, { method: "POST" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {canCreate && (
        <section aria-label="Lập phiếu giao" className="space-y-3 rounded-sm border border-border p-4">
          <h3 className="text-sm font-semibold">Lập phiếu giao</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <InlineField id="delivery-date" label="Ngày giao" required>
              <input id="delivery-date" type="date" max={today} min={ictYmd(order.orderDate)} value={date} onChange={(e) => setDate(e.target.value)} className={igInput} />
            </InlineField>
            <InlineField id="delivery-note" label="Ghi chú">
              <input id="delivery-note" value={note} onChange={(e) => setNote(e.target.value)} className={igInput} />
            </InlineField>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs font-semibold text-fg-secondary"><th className="py-1">Sản phẩm</th><th className="py-1 text-right">Còn phải giao</th><th className="py-1 text-right">Giao lần này</th></tr></thead>
            <tbody>
              {open.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-2"><strong>{l.productName}</strong><span className="block font-mono text-xs text-fg-muted">{l.productCode}</span></td>
                  <td className="py-2 text-right tabular">{formatQty(remainingOf(l))} {l.unit}</td>
                  <td className="w-40 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <NumberInput maxFrac={3} aria-label={`Số lượng giao ${l.productName}`} value={qty[l.id] ?? ""} onValueChange={(val) => setQty((m) => ({ ...m, [l.id]: val }))} className={`${inputClass()} tabular text-right`} />
                      <button type="button" aria-label={`Giao hết ${l.productName}`} onClick={() => setQty((m) => ({ ...m, [l.id]: String(remainingOf(l)) }))} className="h-9 shrink-0 rounded-sm border border-border px-2 text-xs hover:bg-hover">Hết</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button type="button" onClick={create} disabled={busy} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50 md:h-10">Lập phiếu giao</button>
        </section>
      )}

      {order.deliveries.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Chưa có phiếu giao nào.</p>
      ) : (
        <ul className="space-y-3">
          {order.deliveries.map((d) => (
            <li key={d.id} className={`rounded-sm border border-border p-3 ${d.isCancelled ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><strong className="font-mono text-xs">{d.code}</strong> · {formatDateTime(d.at)}{d.isCancelled && <span className="ml-2 text-xs font-medium text-danger">Đã hủy</span>}</span>
                {canPrint && !d.isCancelled && <PrintButton docType="DELIVERY_NOTE" docId={d.id} label="In phiếu giao" className="flex h-9 items-center gap-2 rounded-sm border border-border px-3 text-sm hover:bg-hover disabled:opacity-60" />}
                {canDeliver && !d.isCancelled && (
                  <button type="button" onClick={() => cancel(d.id, d.code)} aria-label={`Hủy phiếu giao ${d.code}`} className="h-9 rounded-sm border border-danger px-3 text-sm text-danger hover:bg-danger-soft">Hủy phiếu</button>
                )}
              </div>
              <ul className="mt-1 text-sm text-fg-secondary">{d.lines.map((l) => <li key={l.orderLineId}>{l.productName}: {formatQty(l.qty)} {l.unit}</li>)}</ul>
              {d.note && <p className="mt-1 text-xs text-fg-muted">{d.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
