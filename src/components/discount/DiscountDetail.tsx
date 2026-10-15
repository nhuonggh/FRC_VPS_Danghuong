"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, ReasonDialog, InlineField, igInput, igArea, NumberInput } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { formatCurrency, formatDate } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { DiscountDetailDTO } from "@/server/discount/queries";

export interface DiscountPerms { canSettle: boolean; canReconcile: boolean }

/** Chiết khấu tích lũy của MỘT khách: số dư, sổ chi tiết, tất toán (chi tiền / trừ công nợ), phiếu tất toán + hậu kiểm. */
export function DiscountDetail({ d, perms, accounts, today }: { d: DiscountDetailDTO; perms: DiscountPerms; accounts: { id: number; name: string }[]; today: string }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [settling, setSettling] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const balance = Number(d.balance);

  async function reconcile(id: number, code: string) {
    const ok = await confirm({ title: `Hậu kiểm ${code}?`, description: "Sau hậu kiểm phiếu tất toán bị khoá — không hủy được nữa.", confirmLabel: "Hậu kiểm" });
    if (!ok || busy) return;
    setBusy(true);
    try { await apiFetch(`/api/discount/settlements/${id}/reconcile`, { method: "POST", idempotencyKey: `${idem.key}-r${id}` }); router.refresh(); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Link href="/accounting/discounts" className="text-sm text-accent hover:underline">← Quay lại sổ chiết khấu</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">{d.partner.name}</h1><p className="text-sm text-fg-secondary"><span className="font-mono">{d.partner.code}</span> · <Link href={`/accounting/debts/${d.partner.id}`} className="text-accent hover:underline">xem công nợ</Link></p></div>
        {perms.canSettle && <button type="button" disabled={balance <= 0} onClick={() => setSettling(true)} className="h-10 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50">Tất toán chiết khấu</button>}
      </div>
      {d.negative && <div role="alert" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">Số dư chiết khấu đang ÂM ({formatCurrency(d.balance)}): khách đã được tất toán nhiều hơn phần còn lại (do hủy đơn / trả hàng sau khi tất toán). Xử lý bằng điều chỉnh công nợ.</div>}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Đầu kỳ" value={d.opening} /><Stat label="Phát sinh (đơn)" value={d.accrued} /><Stat label="Đã tất toán / trừ" value={d.settled} /><Stat label="Còn lại" value={d.balance} tone={d.negative ? "danger" : "success"} />
      </div>

      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">Phiếu tất toán</h2>
        {d.settlements.length === 0 ? <p className="text-sm text-fg-muted">Chưa tất toán lần nào.</p> : (
          <ul className="divide-y divide-border text-sm">
            {d.settlements.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className={s.isCancelled ? "text-fg-muted line-through" : ""}><span className="font-mono text-xs">{s.code}</span> · {formatDate(s.at)} · <strong className="tabular">{formatCurrency(s.amount)}</strong> · {s.methodLabel}{s.paymentCode ? ` (${s.paymentCode})` : ""}{s.note ? ` — ${s.note}` : ""}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {s.isCancelled ? <Badge tone="neutral">Đã hủy{s.cancelReason ? `: ${s.cancelReason}` : ""}</Badge> : s.isReconciled ? <Badge tone="success">Đã hậu kiểm{s.reconciledByName ? ` · ${s.reconciledByName}` : ""}</Badge> : <Badge tone="warning">Chờ hậu kiểm</Badge>}
                  {!s.isCancelled && !s.isReconciled && perms.canReconcile && <button type="button" disabled={busy} onClick={() => reconcile(s.id, s.code)} aria-label={`Hậu kiểm ${s.code}`} className="h-9 rounded-sm bg-accent px-3 text-sm font-medium text-fg-on-accent disabled:opacity-50">Hậu kiểm</button>}
                  {!s.isCancelled && !s.isReconciled && perms.canSettle && <button type="button" disabled={busy} onClick={() => setCancelId(s.id)} aria-label={`Hủy ${s.code}`} className="h-9 rounded-sm border border-danger px-3 text-sm text-danger hover:bg-danger-soft disabled:opacity-50">Hủy</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-x-auto rounded-md border border-border bg-surface">
        <h2 className="border-b border-border p-3 text-sm font-semibold">Sổ chi tiết (mới nhất trước)</h2>
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Chứng từ</th><th className="px-3 py-2 text-right">Phát sinh</th><th className="px-3 py-2 text-right">Giảm</th><th className="px-3 py-2 text-right">Còn lại</th></tr></thead>
          <tbody>
            {d.entries.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="px-3 py-2 whitespace-nowrap">{formatDate(e.at)}</td>
                <td className="px-3 py-2">{e.docLabel} {e.docHref ? <Link href={e.docHref} className="font-mono text-xs text-accent hover:underline">{e.docCode}</Link> : e.docCode ? <span className="font-mono text-xs">{e.docCode}</span> : null}{e.method ? ` · ${e.method === "CASH" ? "chi tiền" : "trừ nợ"}` : ""}</td>
                <td className="px-3 py-2 text-right tabular">{Number(e.amountIn) ? formatCurrency(e.amountIn) : ""}</td><td className="px-3 py-2 text-right tabular">{Number(e.amountOut) ? formatCurrency(e.amountOut) : ""}</td><td className="px-3 py-2 text-right tabular">{formatCurrency(e.running)}</td>
              </tr>
            ))}
            {d.entries.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-fg-muted">Chưa có phát sinh</td></tr>}
          </tbody>
        </table>
      </section>

      <SettleDialog open={settling} onClose={() => setSettling(false)} d={d} accounts={accounts} today={today} idemKey={idem.key} onDone={() => { idem.reset(); router.refresh(); }} />
      <ReasonDialog open={cancelId !== null} onClose={() => setCancelId(null)} title="Hủy phiếu tất toán?" description="Số dư chiết khấu được trả lại; công nợ (nếu trừ nợ) hoặc phiếu chi tiền chưa kiểm được đảo." confirmLabel="Hủy tất toán"
        onConfirm={async (reason) => { await apiFetch(`/api/discount/settlements/${cancelId}/cancel`, { method: "POST", json: { reason }, idempotencyKey: `${idem.key}-c${cancelId}` }); router.refresh(); }} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return <div className="rounded-md border border-border bg-surface p-3"><span className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">{label}</span><span className={`tabular block text-xl font-bold ${tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : ""}`}>{formatCurrency(value)}</span></div>;
}

function SettleDialog({ open, onClose, d, accounts, today, idemKey, onDone }: { open: boolean; onClose: () => void; d: DiscountDetailDTO; accounts: { id: number; name: string }[]; today: string; idemKey: string; onDone: () => void }) {
  const [method, setMethod] = useState<"CASH" | "OFFSET">("CASH");
  const [amount, setAmount] = useState(""); const [accountId, setAccountId] = useState<number>(accounts[0]?.id ?? 0); const [date, setDate] = useState(today); const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const debt = Number(d.partner.debtBalance); const max = method === "OFFSET" ? Math.min(Number(d.balance), Math.max(debt, 0)) : Number(d.balance);
  async function submit() {
    if (busy) return;
    if (!(Number(amount) > 0)) { setError("Nhập số tiền lớn hơn 0."); return; }
    if (Number(amount) > max) { setError(`Tối đa ${formatCurrency(String(max))}.`); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch("/api/discount/settlements", { method: "POST", json: { partnerId: d.partner.id, method, amount: Number(amount), cashAccountId: method === "CASH" ? accountId : null, date, note }, idempotencyKey: idemKey });
      setAmount(""); setNote(""); onDone(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Không tất toán được."); } finally { setBusy(false); }
  }
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-3 overflow-y-auto rounded-lg border border-border bg-raised p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">Tất toán chiết khấu — {d.partner.name}</Dialog.Title>
          <Dialog.Description className="text-sm text-fg-secondary">Còn lại {formatCurrency(d.balance)}. Chi tiền: sinh phiếu chi (thủ quỹ kiểm sau). Trừ công nợ: giảm số khách đang nợ ({formatCurrency(String(Math.max(debt, 0)))}).</Dialog.Description>
          <InlineField id="st-method" label="Hình thức" required><select id="st-method" value={method} onChange={(e) => { setMethod(e.target.value as "CASH" | "OFFSET"); setError(null); }} className={igInput}><option value="CASH">Chi tiền cho khách</option><option value="OFFSET">Trừ vào công nợ</option></select></InlineField>
          <InlineField id="st-amount" label={`Số tiền (tối đa ${formatCurrency(String(max))})`} required><NumberInput id="st-amount" value={amount} onValueChange={setAmount} className={`${igInput} tabular`} /></InlineField>
          {method === "CASH" && <InlineField id="st-account" label="Chi từ quỹ / tài khoản" required><select id="st-account" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))} className={igInput}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></InlineField>}
          <InlineField id="st-date" label="Ngày" required><input id="st-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={igInput} /></InlineField>
          <InlineField id="st-note" label="Ghi chú" multiline><textarea id="st-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={igArea} /></InlineField>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="h-11 rounded-sm border border-border px-4 text-sm hover:bg-hover disabled:opacity-50 md:h-10">Đóng</button><button type="button" onClick={submit} disabled={busy} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60 md:h-10">Tất toán</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
