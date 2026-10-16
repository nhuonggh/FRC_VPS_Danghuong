"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PrintButton } from "@/components/print/PrintButton";
import { Badge, ReasonDialog, InlineField, igInput, igArea, inputClass, NumberInput } from "@/components/ui";
import { Combobox, filterComboOptions } from "@/components/ui/Combobox";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { formatCurrency, formatDateTime, formatQty } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { StopDTO, TripDetailDTO } from "@/server/trips/queries";
import { RESULT_KINDS, RESULT_LABEL } from "@/server/trips/schemas";

export interface TripPerms { canManage: boolean; canSettle: boolean; canConfirm: boolean; canPrint?: boolean }
const TONE = { PLANNED: "info", ON_ROAD: "info", RETURNED: "warning", SETTLED: "warning", CONFIRMED: "success", CANCELLED: "neutral" } as const;
/** Lý do gợi ý để nhập nhanh khi lái xe thu vượt số phải thu / khách được bớt. */
const OVER_REASONS = ["Khách trả nợ cũ", "Khách trả dư, trừ vào đơn sau", "Khách trả trước cho đơn sau", "Trả nợ cũ + đơn này"];
const DISCOUNT_REASONS = ["Làm tròn số tiền", "Khách quen, bớt lẻ", "Khách trả tiền mặt, bớt tiền chẵn", "Hàng lỗi/giao thiếu nhẹ, giảm giá", "Chủ/sale đồng ý bớt"];
const RESULT_TONE = { GIAO_DU: "success", GHI_NO: "warning", HEN_TRA: "warning", KHONG_GIAO: "danger", GIAO_MOT_PHAN: "info" } as const;

export function TripDetail({ trip, perms, accounts }: { trip: TripDetailDTO; perms: TripPerms; accounts: { id: number; name: string; type: "CASH" | "BANK" }[] }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"cancel" | "settle" | "confirm" | null>(null);
  const [stop, setStop] = useState<StopDTO | null>(null);
  const base = `/api/trips/${trip.id}`;
  const open = trip.status === "PLANNED" || trip.status === "ON_ROAD" || trip.status === "RETURNED";
  const hasResults = trip.stops.some((s) => s.result !== null);
  const totals = trip.totals;

  async function run(fn: () => Promise<unknown>) { if (busy) return; setBusy(true); try { await fn(); idem.reset(); router.refresh(); } finally { setBusy(false); } }
  const depart = () => run(() => apiFetch(`${base}/depart`, { method: "POST" }));
  async function clear(s: StopDTO) {
    const ok = await confirm({ title: `Xóa kết quả đơn ${s.orderCode}?`, description: "Phiếu giao và công nợ của lần giao này được hoàn lại.", confirmLabel: "Xóa kết quả", danger: true });
    if (ok) await run(() => apiFetch(`${base}/clear-result`, { method: "POST", json: { orderId: s.orderId } }));
  }

  return (
    <div className="space-y-4">
      <Link href="/delivery/trips" className="text-sm text-accent hover:underline">← Quay lại danh sách chuyến</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold"><span className="font-mono">{trip.code}</span> · {trip.date.split("-").reverse().join("/")}</h1>
          <p className="text-sm text-fg-secondary">{trip.vehiclePlate} · {trip.driverName}{trip.assistantName ? ` + ${trip.assistantName}` : ""}{trip.routeName ? ` · tuyến ${trip.routeName}` : ""}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2"><Badge tone={TONE[trip.status]}>{trip.statusLabel}</Badge>{trip.note && <span className="text-sm text-fg-muted">{trip.note}</span>}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {perms.canPrint && trip.status !== "CANCELLED" && <PrintButton docType="TRIP_SHEET" docId={trip.id} label="In phiếu giao nhận" />}
          {perms.canManage && trip.status === "PLANNED" && <button type="button" disabled={busy} onClick={depart} className="h-10 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50">Xuất phát</button>}
          {perms.canSettle && trip.status === "RETURNED" && <button type="button" disabled={busy} onClick={() => setDialog("settle")} className="h-10 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50">Đối soát lái xe</button>}
          {perms.canConfirm && trip.status === "SETTLED" && <button type="button" disabled={busy} onClick={() => setDialog("confirm")} className="h-10 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50">Xác nhận đã nhận tiền</button>}
          {perms.canManage && (trip.status === "PLANNED" || trip.status === "ON_ROAD") && !hasResults && <button type="button" disabled={busy} onClick={() => setDialog("cancel")} className="h-10 rounded-sm border border-danger px-3 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50">Hủy chuyến</button>}
        </div>
      </div>
      {trip.status === "CANCELLED" && <div role="status" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">Chuyến đã hủy{trip.cancelReason ? `: ${trip.cancelReason}` : ""}.</div>}
      {trip.status === "SETTLED" && <div role="status" className="rounded-sm border border-warning bg-warning-soft p-3 text-sm">Đã đối soát{trip.settled?.byName ? ` bởi ${trip.settled.byName}` : ""}. Tiền lái xe thu <strong>chưa vào quỹ</strong> cho tới khi thủ quỹ xác nhận đã nhận.{trip.settled?.diffReason ? ` Chênh lệch: ${trip.settled.diffReason}.` : ""}</div>}
      {trip.confirmed && <div role="status" className="rounded-sm border border-success bg-success-soft p-3 text-sm">Thủ quỹ {trip.confirmed.byName} đã nhận tiền {formatDateTime(trip.confirmed.at)}{trip.confirmed.cashAccountName ? ` · tiền mặt vào ${trip.confirmed.cashAccountName}` : ""}{trip.confirmed.transferAccountName ? ` · chuyển khoản vào ${trip.confirmed.transferAccountName}` : ""}. Phiếu thu: {trip.receipts.map((r, i) => <span key={r.id}>{i ? ", " : ""}<Link href={`/accounting/receipts/${r.id}`} className="font-mono text-accent hover:underline">{r.code}</Link></span>)}.</div>}

      <div className="grid gap-3 sm:grid-cols-5">
        <Stat label="Phải thu" value={totals.expected} /><Stat label="Tiền mặt" value={totals.cash} /><Stat label="Chuyển khoản" value={totals.transfer} /><Stat label="Ghi nợ / hẹn trả" value={totals.debt} />
        <Stat label="Chênh lệch" value={totals.diff} tone={Number(totals.diff) === 0 ? "success" : "danger"} />
      </div>

      <section className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">#</th><th className="px-3 py-2">Đơn / khách</th><th className="px-3 py-2">Kết quả</th><th className="px-3 py-2 text-right">Phải thu</th><th className="px-3 py-2 text-right">Tiền mặt</th><th className="px-3 py-2 text-right">CK</th><th className="px-3 py-2 text-right">Ghi nợ</th><th className="px-3 py-2 text-right">Thao tác</th></tr></thead>
          <tbody>
            {trip.stops.map((s) => (
              <tr key={s.id} className="border-t border-border align-top">
                <td className="px-3 py-2 text-fg-muted">{s.seq}</td>
                <td className="px-3 py-2"><Link href={`/sales/orders/${s.orderId}`} className="font-mono text-xs text-accent hover:underline">{s.orderCode}</Link> · <strong>{s.partnerName}</strong><span className="block text-xs text-fg-muted">{[s.phone, s.address].filter(Boolean).join(" · ")}</span></td>
                <td className="px-3 py-2">{s.result ? <><Badge tone={RESULT_TONE[s.result]}>{s.resultLabel}</Badge>{s.promiseDate && <span className="block text-xs text-fg-muted">hẹn {s.promiseDate.split("-").reverse().join("/")}</span>}{Number(s.discount) > 0 && <span className="block text-xs text-fg-muted">bớt {formatCurrency(s.discount)}</span>}{Number(s.over) > 0 && <span className="block text-xs text-fg-muted">thu vượt {formatCurrency(s.over)} (nợ cũ/dư)</span>}{s.resultNote && <span className="block text-xs text-fg-muted">{s.resultNote}</span>}</> : <span className="text-fg-muted">Chưa có</span>}</td>
                <td className="px-3 py-2 text-right tabular">{s.due !== null ? formatCurrency(s.due) : ""}</td><td className="px-3 py-2 text-right tabular">{s.result ? formatCurrency(s.cash) : ""}</td><td className="px-3 py-2 text-right tabular">{s.result ? formatCurrency(s.transfer) : ""}</td><td className="px-3 py-2 text-right tabular">{s.result ? formatCurrency(s.debt) : ""}</td>
                <td className="px-3 py-2 text-right">
                  {perms.canManage && open && (
                    <div className="flex justify-end gap-2">
                      <button type="button" disabled={busy} onClick={() => setStop(s)} aria-label={`${s.result ? "Sửa kết quả" : "Nhập kết quả"} ${s.orderCode}`} className={`h-9 rounded-sm px-3 text-sm ${s.result ? "border border-border hover:bg-hover" : "bg-accent font-medium text-fg-on-accent"} disabled:opacity-50`}>{s.result ? "Sửa" : "Nhập kết quả"}</button>
                      {s.canCancelResult && <button type="button" disabled={busy} onClick={() => clear(s)} aria-label={`Xóa kết quả ${s.orderCode}`} className="h-9 rounded-sm border border-danger px-3 text-sm text-danger hover:bg-danger-soft disabled:opacity-50">Xóa</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ReasonDialog open={dialog === "cancel"} onClose={() => setDialog(null)} title={`Hủy chuyến ${trip.code}?`} description="Các đơn trong chuyến trở về trạng thái chưa xếp." confirmLabel="Hủy chuyến"
        onConfirm={async (reason) => { await apiFetch(`${base}/cancel`, { method: "POST", json: { reason } }); router.refresh(); }} />
      {stop && <ResultDialog key={stop.id} stop={stop} tripId={trip.id} accounts={accounts} onClose={() => setStop(null)} onDone={() => { idem.reset(); router.refresh(); }} idemKey={idem.key} />}
      <SettleDialog open={dialog === "settle"} onClose={() => setDialog(null)} trip={trip} idemKey={idem.key} onDone={() => { idem.reset(); router.refresh(); }} />
      <ConfirmDialog open={dialog === "confirm"} onClose={() => setDialog(null)} trip={trip} accounts={accounts} idemKey={idem.key} onDone={() => { idem.reset(); router.refresh(); }} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return <div className="rounded-md border border-border bg-surface p-3"><span className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">{label}</span><span className={`tabular block text-xl font-bold ${tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : ""}`}>{formatCurrency(value)}</span></div>;
}

const shell = "fixed left-1/2 top-1/2 z-dialog max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 space-y-3 overflow-y-auto rounded-lg border border-border bg-raised p-5 shadow-lg";
const btnPrimary = "h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60 md:h-10";
const btnGhost = "h-11 rounded-sm border border-border px-4 text-sm hover:bg-hover disabled:opacity-50 md:h-10";

/** Nhập / sửa kết quả một điểm giao (40). Giao một phần nhập số lượng thực giao từng dòng. */
export function ResultDialog({ stop, tripId, accounts, onClose, onDone, idemKey }: { stop: StopDTO; tripId: number; accounts: { id: number; name: string; type: "CASH" | "BANK" }[]; onClose: () => void; onDone: () => void; idemKey: string }) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const cashAccounts = accounts.filter((a) => a.type === "CASH"), bankAccounts = accounts.filter((a) => a.type === "BANK");
  const [cashId, setCashId] = useState<number | "">(stop.cashAccountId ?? (cashAccounts.length === 1 ? cashAccounts[0]!.id : ""));
  const [bankId, setBankId] = useState<number | "">(stop.transferAccountId ?? (bankAccounts.length === 1 ? bankAccounts[0]!.id : ""));
  const [result, setResult] = useState<(typeof RESULT_KINDS)[number]>(stop.result ?? "GIAO_DU");
  const [cash, setCash] = useState(stop.result ? stop.cash : stop.suggestedDue);
  const [transfer, setTransfer] = useState(stop.result ? stop.transfer : "0");
  const [debt, setDebt] = useState(stop.result ? stop.debt : "0");
  const [discount, setDiscount] = useState(stop.result ? stop.discount : "0");
  const [promise, setPromise] = useState(stop.promiseDate ?? "");
  const [note, setNote] = useState(stop.resultNote ?? "");
  const [qty, setQty] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const due = Number(stop.suggestedDue);
  const bot = Number(discount || 0);
  const over = Math.max(0, Number(cash || 0) + Number(transfer || 0) + bot - due);
  const needNote = result === "KHONG_GIAO" || bot > 0 || over > 0;
  const addReason = (text: string) => setNote((n) => (n.includes(text) ? n : n.trim() ? `${n.trim()}; ${text}` : text));

  function pick(next: (typeof RESULT_KINDS)[number]) {
    setResult(next); setError(null);
    if (next === "KHONG_GIAO") { setCash("0"); setTransfer("0"); setDebt("0"); setDiscount("0"); }
    else if (next === "GHI_NO" || next === "HEN_TRA") { setCash("0"); setDebt(String(due)); }
    else if (next === "GIAO_DU") { setCash(String(due)); setDebt("0"); }
  }
  async function submit() {
    if (busy) return;
    const lines = stop.lines.map((l) => ({ orderLineId: l.orderLineId, qty: Number(qty[l.orderLineId] ?? 0) })).filter((l) => l.qty > 0);
    if (result === "GIAO_MOT_PHAN") {
      const over = stop.lines.find((l) => Number(qty[l.orderLineId] ?? 0) > Number(l.remaining));
      if (over) { setError(`${over.productName}: chỉ còn ${formatQty(over.remaining)} ${over.unit}.`); return; }
    }
    if (needNote && result !== "KHONG_GIAO" && !note.trim()) { setError(bot > 0 ? "Có tiền bớt — nhập lý do bớt." : "Thu vượt số phải thu — nhập lý do (VD: khách trả nợ cũ)."); return; }
    if (result !== "KHONG_GIAO" && Number(cash || 0) > 0 && cashId === "") { setError("Chọn quỹ tiền mặt nhận tiền."); return; }
    if (result !== "KHONG_GIAO" && Number(transfer || 0) > 0 && bankId === "") { setError("Chọn tài khoản ngân hàng nhận chuyển khoản."); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch(`/api/trips/${tripId}/result`, { method: "POST", json: { orderId: stop.orderId, result, lines: result === "GIAO_MOT_PHAN" ? lines : [], cashAmount: Number(cash || 0), transferAmount: Number(transfer || 0), cashAccountId: Number(cash || 0) > 0 && cashId !== "" ? cashId : null, transferAccountId: Number(transfer || 0) > 0 && bankId !== "" ? bankId : null, debtAmount: Number(debt || 0), discountAmount: Number(discount || 0), promiseDate: result === "HEN_TRA" ? promise || null : null, note }, idempotencyKey: `${idemKey}-${stop.id}` });
      onDone(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được kết quả."); } finally { setBusy(false); }
  }
  const money = (id: string, label: string, value: string, set: (v: string) => void) => (
    <InlineField id={id} label={label}><NumberInput id={id} value={value} onValueChange={set} className={`${igInput} tabular text-right`} /></InlineField>
  );
  const acct = (id: string, label: string, list: { id: number; name: string }[], value: number | "", set: (v: number | "") => void, placeholder: string) => {
    const options = list.map((a) => ({ value: a.id, label: a.name }));
    return <div id={id} className="[&_input]:min-h-11"><Combobox label={label} value={options.find((o) => o.value === value) ?? null} onChange={(o) => set(o ? Number(o.value) : "")} loadOptions={async (q) => filterComboOptions(options, q)} placeholder={placeholder} disabled={busy} overlay portalContainer={portalContainer} /></div>;
  };
  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content ref={setPortalContainer} className="fixed inset-x-0 bottom-0 z-dialog max-h-[90dvh] space-y-3 overflow-y-auto rounded-t-lg border border-border bg-raised p-4 shadow-lg md:inset-0 md:m-auto md:h-fit md:w-[calc(100%-2rem)] md:max-w-lg md:rounded-lg md:p-5">
          <Dialog.Title className="sticky top-0 z-header border-b border-border bg-raised pb-3 text-base font-semibold">Kết quả giao — {stop.orderCode}</Dialog.Title>
          <Dialog.Description className="text-sm text-fg-secondary">{stop.partnerName}. Giao hết phần còn lại thì phải thu ≈ <strong className="tabular">{formatCurrency(stop.suggestedDue)}</strong> (giá trị đơn − tiền đã thu). Khách đưa nhiều hơn (trả nợ cũ/trả dư) hoặc ít hơn (được bớt) đều nhập được, kèm lý do.</Dialog.Description>
          <InlineField id="rs-kind" label="Kết quả" required><select id="rs-kind" value={result} onChange={(e) => pick(e.target.value as (typeof RESULT_KINDS)[number])} className={igInput}>{RESULT_KINDS.map((k) => <option key={k} value={k}>{RESULT_LABEL[k]}</option>)}</select></InlineField>
          {result === "GIAO_MOT_PHAN" && (
            <div className="space-y-2 rounded-sm border border-border p-2">
              <p className="text-xs font-semibold text-fg-secondary">Số lượng thực giao</p>
              {stop.lines.filter((l) => Number(l.remaining) > 0).map((l) => (
                <label key={l.orderLineId} className="flex items-center justify-between gap-2 text-sm"><span>{l.productName}{l.processingTypeName ? <span className="text-fg-secondary"> · {l.processingTypeName}</span> : null}<span className="block text-xs text-fg-muted">còn {formatQty(l.remaining)} {l.unit}</span></span>
                  <NumberInput maxFrac={3} aria-label={`SL giao ${l.productCode}`} value={qty[l.orderLineId] ?? ""} onValueChange={(val) => setQty((q) => ({ ...q, [l.orderLineId]: val }))} className={`${inputClass()} w-28 tabular`} /></label>
              ))}
            </div>
          )}
          {result !== "KHONG_GIAO" && (
            <div className="grid gap-3">{money("rs-cash", "Tiền mặt", cash, setCash)}{Number(cash || 0) > 0 && acct("rs-cash-acc", "Nhận vào quỹ", cashAccounts, cashId, setCashId, "Chọn quỹ…")}{money("rs-transfer", "Chuyển khoản", transfer, setTransfer)}{Number(transfer || 0) > 0 && acct("rs-bank-acc", "Nhận vào tài khoản", bankAccounts, bankId, setBankId, "Chọn tài khoản…")}{result !== "GIAO_DU" && money("rs-debt", result === "HEN_TRA" ? "Hẹn trả" : "Ghi nợ", debt, setDebt)}{money("rs-discount", "Bớt cho khách", discount, setDiscount)}</div>
          )}
          {result !== "KHONG_GIAO" && over > 0 && <p role="status" className="rounded-sm border border-warning bg-warning-soft px-3 py-2 text-xs">Thu vượt phải thu <strong className="tabular">{formatCurrency(over)}</strong> — phần này trừ vào công nợ cũ / thành số dư của khách (không tính vào đơn này). Nhập lý do bên dưới.</p>}
          {result !== "KHONG_GIAO" && bot > 0 && <p role="status" className="rounded-sm border border-border bg-hover px-3 py-2 text-xs">Tiền bớt <strong className="tabular">{formatCurrency(bot)}</strong> ghi giảm công nợ của khách, không vào quỹ.</p>}
          {result === "HEN_TRA" && <InlineField id="rs-promise" label="Ngày khách hẹn trả" required><input id="rs-promise" type="date" value={promise} onChange={(e) => setPromise(e.target.value)} className={igInput} /></InlineField>}
          <InlineField id="rs-note" label={result === "KHONG_GIAO" ? "Lý do không giao được" : bot > 0 || over > 0 ? "Lý do bớt / thu vượt" : "Ghi chú"} required={needNote} multiline><textarea id="rs-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={igArea} /></InlineField>
          {result !== "KHONG_GIAO" && (bot > 0 || over > 0) && (
            <div className="flex flex-wrap gap-1.5" aria-label="Lý do gợi ý">
              {[...(bot > 0 ? DISCOUNT_REASONS : []), ...(over > 0 ? OVER_REASONS : [])].map((r) => (
                <button key={r} type="button" onClick={() => addReason(r)} className="h-8 rounded-full border border-border px-3 text-xs hover:bg-hover">{r}</button>
              ))}
            </div>
          )}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-raised pt-3"><button type="button" onClick={onClose} disabled={busy} className={btnGhost}>Đóng</button><button type="button" onClick={submit} disabled={busy} className={btnPrimary}>Lưu kết quả</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Đối soát lái xe (41): phải thu − tiền mặt − CK − ghi nợ = chênh lệch; ≠ 0 bắt buộc lý do. */
function SettleDialog({ open, onClose, trip, idemKey, onDone }: { open: boolean; onClose: () => void; trip: TripDetailDTO; idemKey: string; onDone: () => void }) {
  const [reason, setReason] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const diff = Number(trip.totals.diff);
  async function submit() {
    if (busy) return;
    if (diff !== 0 && !reason.trim()) { setError("Có chênh lệch — nhập lý do."); return; }
    setBusy(true); setError(null);
    try { await apiFetch(`/api/trips/${trip.id}/settle`, { method: "POST", json: { reason }, idempotencyKey: idemKey }); onDone(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Không đối soát được."); } finally { setBusy(false); }
  }
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content className={shell}>
          <Dialog.Title className="text-base font-semibold">Đối soát lái xe — {trip.code}</Dialog.Title>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <Row label="Phải thu" value={trip.totals.expected} /><Row label="− Tiền mặt" value={trip.totals.cash} /><Row label="− Chuyển khoản" value={trip.totals.transfer} /><Row label="− Ghi nợ / hẹn trả" value={trip.totals.debt} />
            {Number(trip.totals.discount) > 0 && <Row label="− Tiền bớt cho khách" value={trip.totals.discount} />}{Number(trip.totals.over) > 0 && <Row label="+ Thu vượt (nợ cũ/dư, đã có lý do)" value={trip.totals.over} />}
            <div className="flex justify-between border-t border-border pt-1 font-semibold sm:col-span-2"><dt>Chênh lệch</dt><dd className={`tabular ${diff === 0 ? "text-success" : "text-danger"}`}>{formatCurrency(trip.totals.diff)}</dd></div>
          </dl>
          {diff !== 0 && <InlineField id="st-reason" label="Lý do chênh lệch" required multiline><textarea id="st-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={igArea} /></InlineField>}
          <p className="text-xs text-fg-muted">Đối soát xong chuyến chuyển cho thủ quỹ xác nhận nhận tiền; kết quả các điểm giao bị khoá.</p>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className={btnGhost}>Đóng</button><button type="button" onClick={submit} disabled={busy} className={btnPrimary}>Đối soát</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
const Row = ({ label, value }: { label: string; value: string }) => <div className="flex justify-between"><dt className="text-fg-secondary">{label}</dt><dd className="tabular">{formatCurrency(value)}</dd></div>;

/** Thủ quỹ xác nhận đã nhận tiền (D-35): tiền mặt vào quỹ, chuyển khoản vào tài khoản NH — sinh phiếu thu chờ hậu kiểm. */
function ConfirmDialog({ open, onClose, trip, accounts, idemKey, onDone }: { open: boolean; onClose: () => void; trip: TripDetailDTO; accounts: { id: number; name: string; type: "CASH" | "BANK" }[]; idemKey: string; onDone: () => void }) {
  const cashAccounts = accounts.filter((a) => a.type === "CASH"); const bankAccounts = accounts.filter((a) => a.type === "BANK");
  const [cashId, setCashId] = useState<number | "">(cashAccounts[0]?.id ?? ""); const [bankId, setBankId] = useState<number | "">(bankAccounts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const needCash = trip.stops.some((s) => Number(s.cash) > 0 && s.cashAccountId === null), needBank = trip.stops.some((s) => Number(s.transfer) > 0 && s.transferAccountId === null);
  async function submit() {
    if (busy) return;
    if (needCash && cashId === "") { setError("Chọn quỹ tiền mặt."); return; }
    if (needBank && bankId === "") { setError("Chọn tài khoản ngân hàng."); return; }
    setBusy(true); setError(null);
    try { await apiFetch(`/api/trips/${trip.id}/confirm`, { method: "POST", json: { cashAccountId: needCash ? cashId : null, transferAccountId: needBank ? bankId : null }, idempotencyKey: idemKey }); onDone(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Không xác nhận được."); } finally { setBusy(false); }
  }
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content className={shell}>
          <Dialog.Title className="text-base font-semibold">Xác nhận nhận tiền — {trip.code}</Dialog.Title>
          <Dialog.Description className="text-sm text-fg-secondary">Thủ quỹ đã nhận: tiền mặt <strong className="tabular">{formatCurrency(trip.totals.cash)}</strong>, chuyển khoản <strong className="tabular">{formatCurrency(trip.totals.transfer)}</strong>. Hệ thống sinh phiếu thu vào quỹ (chờ hậu kiểm); công nợ khách không đổi vì đã ghi lúc nhập kết quả.</Dialog.Description>
          {needCash && <InlineField id="cf-cash" label="Tiền mặt vào quỹ" required><select id="cf-cash" value={cashId} onChange={(e) => setCashId(e.target.value ? Number(e.target.value) : "")} className={igInput}><option value="">Chọn quỹ…</option>{cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></InlineField>}
          {needBank && <InlineField id="cf-bank" label="Chuyển khoản vào tài khoản" required><select id="cf-bank" value={bankId} onChange={(e) => setBankId(e.target.value ? Number(e.target.value) : "")} className={igInput}><option value="">Chọn tài khoản…</option>{bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></InlineField>}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className={btnGhost}>Đóng</button><button type="button" onClick={submit} disabled={busy} className={btnPrimary}>Đã nhận tiền</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
