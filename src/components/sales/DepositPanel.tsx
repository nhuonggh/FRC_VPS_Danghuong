"use client";

import { igInput, InlineField } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-fetch";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { OrderDetailDTO } from "@/server/sales/queries";
import { DepositActions } from "./DepositActions";

interface CashOption { id: number; name: string }

/** Tab Tiền cọc (mã 34c/34b): thu cọc trước khi giao, chuyển cọc thành số dư, hủy phiếu nhập nhầm. */
export function DepositPanel({ order, today, canDeposit }: { order: OrderDetailDTO; today: string; canDeposit: boolean }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [options, setOptions] = useState<CashOption[]>([]);
  const [amount, setAmount] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCreate = canDeposit && !order.isCancelled;

  // Quỹ chỉ tải khi người dùng bắt đầu nhập (panel nằm cùng màn hình với các phần khác nên không tải sẵn)
  const [loaded, setLoaded] = useState(false);
  const loadOptions = () => {
    if (loaded || !canCreate) return;
    setLoaded(true);
    Promise.resolve(apiFetch<CashOption[]>("/api/deposits/options/cash-accounts")).then((o) => { const list = o ?? []; setOptions(list); setCashAccountId((c) => c || String(list[0]?.id ?? "")); }).catch(() => setOptions([]));
  };

  async function create() {
    if (busy) return;
    const value = Number(amount);
    if (!(value > 0)) { setError("Nhập số tiền cọc lớn hơn 0."); return; }
    if (!cashAccountId) { setError("Chọn quỹ/tài khoản nhận tiền."); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch("/api/deposits", { method: "POST", json: { orderId: order.id, amount: value, cashAccountId: Number(cashAccountId), date, note }, idempotencyKey: idem.key });
      idem.reset(); setAmount(""); setNote(""); router.refresh();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Không lập được phiếu cọc.");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      {canCreate && (
        <section aria-label="Thu tiền cọc" className="space-y-3 rounded-sm border border-border p-4" onFocusCapture={loadOptions} onPointerDownCapture={loadOptions}>
          <h3 className="text-sm font-semibold">Thu tiền cọc</h3>
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            <InlineField id="dep-amount" label="Số tiền">
              <input id="dep-amount" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${igInput} tabular text-right`} />
            </InlineField>
            <InlineField id="dep-account" label="Quỹ / tài khoản">
              <select id="dep-account" value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)} className={`${igInput} cursor-pointer`}>
                {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </InlineField>
            <InlineField id="dep-date" label="Ngày thu">
              <input id="dep-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={igInput} />
            </InlineField>
            <InlineField id="dep-note" label="Ghi chú">
              <input id="dep-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className={igInput} />
            </InlineField>
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button type="button" onClick={create} disabled={busy} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50 md:h-10">Lưu phiếu cọc</button>
        </section>
      )}
      {order.deposits.length === 0 ? <p className="text-sm text-fg-muted">Chưa có tiền cọc.</p> : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Phiếu</th><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Quỹ</th><th className="px-3 py-2 text-right">Số tiền</th><th className="px-3 py-2" /></tr></thead>
            <tbody>
              {order.deposits.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{d.code}</td><td className="px-3 py-2">{formatDateTime(d.at)}</td><td className="px-3 py-2">{d.cashAccountName}</td>
                  <td className="px-3 py-2 text-right tabular">{formatCurrency(d.amount)}</td>
                  <td className="px-3 py-2 text-right">{canDeposit && <DepositActions id={d.id} code={d.code} attached />}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-semibold"><td className="px-3 py-2" colSpan={3}>Tổng cọc</td><td className="px-3 py-2 text-right tabular">{formatCurrency(order.depositTotal)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
