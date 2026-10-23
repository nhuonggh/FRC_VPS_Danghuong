"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { InlineField, igArea, igInput } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { TripDetailDTO } from "@/server/trips/queries";

type Account = { id: number; name: string; type: "CASH" | "BANK" };
const btn = "h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60 md:h-10";

/**
 * Đối soát lái xe + thủ quỹ xác nhận nhận tiền ngay dưới bảng điểm giao (một người làm cả hai bước).
 * Quỹ tiền mặt chọn một lần cho cả chuyến; tài khoản ngân hàng đã chọn theo từng điểm lúc nhập kết quả
 * (chỉ hỏi lại ở đây nếu có điểm CK chưa chọn tài khoản). Gọi đúng 2 API cũ: settle → confirm.
 */
export function TripSettlePanel({ trip, accounts, canSettle, canConfirm }: { trip: TripDetailDTO; accounts: Account[]; canSettle: boolean; canConfirm: boolean }) {
  const router = useRouter(); const uid = useId();
  const idem = useIdempotencyKey();
  const cashAccounts = accounts.filter((a) => a.type === "CASH"), bankAccounts = accounts.filter((a) => a.type === "BANK");
  const [cashId, setCashId] = useState<number | "">(cashAccounts[0]?.id ?? "");
  const [bankId, setBankId] = useState<number | "">(bankAccounts.length === 1 ? bankAccounts[0]!.id : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const diff = Number(trip.totals.diff);
  const toSettle = trip.status === "RETURNED" && canSettle;
  const toConfirm = (trip.status === "SETTLED" || (toSettle)) && canConfirm;
  if (!toSettle && !(trip.status === "SETTLED" && canConfirm)) return null;
  const needCash = toConfirm && trip.stops.some((s) => Number(s.cash) > 0 && s.cashAccountId === null);
  const needBank = toConfirm && trip.stops.some((s) => Number(s.transfer) > 0 && s.transferAccountId === null);
  const label = toSettle && toConfirm ? "Đối soát và xác nhận đã nhận tiền" : toSettle ? "Đối soát lái xe" : "Xác nhận đã nhận tiền";

  async function submit() {
    if (busy) return;
    if (toSettle && diff !== 0 && !reason.trim()) { setError("Có chênh lệch — nhập lý do."); return; }
    if (needCash && cashId === "") { setError("Chọn quỹ tiền mặt nhận tiền."); return; }
    if (needBank && bankId === "") { setError("Chọn tài khoản ngân hàng nhận chuyển khoản."); return; }
    setBusy(true); setError(null);
    const base = `/api/trips/${trip.id}`;
    try {
      if (toSettle) await apiFetch(`${base}/settle`, { method: "POST", json: { reason }, idempotencyKey: `${idem.key}-settle` });
      if (toConfirm) await apiFetch(`${base}/confirm`, { method: "POST", json: { cashAccountId: needCash ? cashId : null, transferAccountId: needBank ? bankId : null }, idempotencyKey: `${idem.key}-confirm` });
      idem.reset(); router.refresh();
    } catch (e) {
      // Đối soát xong mà xác nhận lỗi: tải lại để panel chuyển sang bước "Xác nhận đã nhận tiền".
      setError(e instanceof Error ? e.message : "Không hoàn tất được.");
      if (toSettle) router.refresh();
    } finally { setBusy(false); }
  }

  const row = (name: string, value: string) => <div className="flex justify-between gap-3"><dt className="text-fg-secondary">{name}</dt><dd className="tabular-nums">{formatCurrency(value)}</dd></div>;
  return (
    <section aria-label={`Đối soát chuyến ${trip.code}`} className="space-y-3 rounded-md border border-border bg-surface p-4">
      <p className="text-sm font-semibold">{toSettle ? "Đối soát lái xe" : "Thủ quỹ xác nhận nhận tiền"} · {trip.code}</p>
      <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {row("Phải thu", trip.totals.expected)}{row("− Tiền mặt", trip.totals.cash)}{row("− Chuyển khoản", trip.totals.transfer)}{row("− Ghi nợ / hẹn trả", trip.totals.debt)}
        {Number(trip.totals.discount) > 0 && row("− Tiền bớt cho khách", trip.totals.discount)}{Number(trip.totals.over) > 0 && row("+ Thu vượt (nợ cũ/dư)", trip.totals.over)}
        <div className="flex justify-between gap-3 border-t border-border pt-1 font-semibold sm:col-span-2 lg:col-span-3"><dt>Chênh lệch</dt><dd className={`tabular-nums ${diff === 0 ? "text-success" : "text-danger"}`}>{formatCurrency(trip.totals.diff)}</dd></div>
      </dl>
      {toSettle && diff !== 0 && <InlineField id={`${uid}-reason`} label="Lý do chênh lệch" required multiline><textarea id={`${uid}-reason`} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={igArea} /></InlineField>}
      {(needCash || needBank) && <div className="grid gap-3 sm:grid-cols-2">
        {needCash && <InlineField id={`${uid}-cash`} label="Tiền mặt vào quỹ" required><select id={`${uid}-cash`} value={cashId} onChange={(e) => setCashId(e.target.value ? Number(e.target.value) : "")} className={igInput}><option value="">Chọn quỹ…</option>{cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></InlineField>}
        {needBank && <InlineField id={`${uid}-bank`} label="Chuyển khoản vào tài khoản" required><select id={`${uid}-bank`} value={bankId} onChange={(e) => setBankId(e.target.value ? Number(e.target.value) : "")} className={igInput}><option value="">Chọn tài khoản…</option>{bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></InlineField>}
      </div>}
      <p className="text-xs text-fg-secondary">{toConfirm ? "Xác nhận xong, hệ thống sinh phiếu thu vào quỹ (chờ hậu kiểm); kết quả các điểm giao bị khóa." : "Đối soát xong chuyến chuyển cho thủ quỹ xác nhận nhận tiền; kết quả các điểm giao bị khóa."}</p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end"><button type="button" onClick={submit} disabled={busy} className={btn}>{label}</button></div>
    </section>
  );
}
