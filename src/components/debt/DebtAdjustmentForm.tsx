"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Scale } from "lucide-react";
import { Combobox, FormCard, FormGrid, igArea, igCombo, igInput, InlineField, NewPage, type ComboOption, NumberInput } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { DEBT_REASONS, REASON_LABEL } from "@/server/debt/schemas";

/** Điều chỉnh công nợ (64): hàng lỗi, bẹp/móp, trừ bằng chiết khấu tích lũy, khác. Ghi chú bắt buộc. */
export function DebtAdjustmentForm({ today, partner }: { today: string; partner: ComboOption | null }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [p, setP] = useState<ComboOption | null>(partner);
  const [reason, setReason] = useState<(typeof DEBT_REASONS)[number]>("HANG_LOI");
  const [direction, setDirection] = useState<"DECREASE" | "INCREASE">("DECREASE");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [discBalance, setDiscBalance] = useState<number | null>(null);
  const [remainder, setRemainder] = useState<"KEEP" | "FORFEIT">("KEEP");
  const isDiscount = reason === "CHIET_KHAU";
  const partnerId = p?.value;

  useEffect(() => {
    if (!isDiscount || !partnerId) { setDiscBalance(null); return; }
    let alive = true;
    apiFetch<{ balance: string | null }>(`/api/debts/partners/${partnerId}/discount`).then((r) => { if (alive) setDiscBalance(r.balance === null ? null : Number(r.balance)); }).catch(() => { if (alive) setDiscBalance(null); });
    return () => { alive = false; };
  }, [isDiscount, partnerId]);
  const rest = isDiscount && discBalance !== null ? discBalance - (Number(amount) || 0) : 0;

  async function submit() {
    if (!p) throw new Error("Chọn đối tác.");
    if (!(Number(amount) > 0)) throw new Error("Nhập số tiền lớn hơn 0.");
    if (!note.trim()) throw new Error("Nhập ghi chú.");
    await apiFetch("/api/debts/adjustments", { method: "POST", json: { partnerId: Number(p.value), reason, direction: isDiscount ? "DECREASE" : direction, amount: Number(amount), date, note, ...(isDiscount && rest > 0 ? { discountRemainder: remainder } : {}) }, idempotencyKey: idem.key });
    router.replace(p ? `/accounting/debts/${p.value}` : "/accounting/debt-adjustments");
  }
  const load = (q: string) => apiFetch<ComboOption[]>(`/api/debts/partners?q=${encodeURIComponent(q)}`);

  return (
    <NewPage bare backHref="/accounting/debt-adjustments" backLabel="Quay lại danh sách" title="Điều chỉnh công nợ" submitLabel="Lưu điều chỉnh" isDirty={() => Boolean(amount || note)} onSubmit={submit}>
      <FormCard icon={Scale} title="Thông tin điều chỉnh">
        <FormGrid cols={2}>
          <InlineField id="partner" label="Đối tác" required className="md:col-span-2">
            <div className={igCombo}><Combobox hideLabel label="Đối tác" value={p} loadOptions={load} placeholder="Tìm khách / nhà cung cấp…" onChange={setP} /></div>
          </InlineField>
          <InlineField id="reason" label="Lý do" required labelClass="sm:min-w-44">
            <select id="reason" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className={`${igInput} cursor-pointer`}>
              {DEBT_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </select>
          </InlineField>
          <InlineField id="direction" label="Tác động lên số dư" required labelClass="sm:min-w-44">
            <select id="direction" value={reason === "CHIET_KHAU" ? "DECREASE" : direction} disabled={reason === "CHIET_KHAU"} onChange={(e) => setDirection(e.target.value as typeof direction)} className={`${igInput} cursor-pointer`}>
              <option value="DECREASE">Giảm số dư (giảm nợ)</option><option value="INCREASE">Tăng số dư (tăng nợ)</option>
            </select>
          </InlineField>
          <InlineField id="amount" label="Số tiền" required labelClass="sm:min-w-44">
            <NumberInput id="amount" value={amount} onValueChange={setAmount} className={`${igInput} tabular text-right`} />
          </InlineField>
          <InlineField id="date" label="Ngày" required labelClass="sm:min-w-44">
            <input id="date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={igInput} />
          </InlineField>
          <InlineField id="note" label="Ghi chú" required multiline className="md:col-span-2">
            <textarea id="note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={igArea} />
          </InlineField>
        </FormGrid>
        {isDiscount && (
          <div className="mt-3 space-y-2 rounded-sm border border-border bg-hover p-3 text-sm">
            <p className="text-fg-secondary">Trừ nợ bằng chiết khấu tích lũy: số tiền tiêu hao số dư chiết khấu của đối tác, không vượt số dư còn.</p>
            {p && discBalance !== null && (
              <p>Chiết khấu tích lũy hiện có: <strong className="tabular">{formatCurrency(String(discBalance))}</strong>
                {Number(amount) > 0 && <> · Sau khi trừ còn: <strong className={`tabular ${rest < 0 ? "text-danger" : ""}`}>{formatCurrency(String(rest))}</strong></>}</p>
            )}
            {rest > 0 && (
              <fieldset className="space-y-1">
                <legend className="font-medium">Phần chiết khấu còn dư {formatCurrency(String(rest))}:</legend>
                <label className="flex cursor-pointer items-start gap-2"><input type="radio" name="remainder" checked={remainder === "KEEP"} onChange={() => setRemainder("KEEP")} className="mt-1" /><span>Giữ lại quỹ chiết khấu (tiếp tục tích lũy)</span></label>
                <label className="flex cursor-pointer items-start gap-2"><input type="radio" name="remainder" checked={remainder === "FORFEIT"} onChange={() => setRemainder("FORFEIT")} className="mt-1" /><span>Chuyển vào lãi công ty (hết số dư, khách không còn quyền lợi này)</span></label>
              </fieldset>
            )}
          </div>
        )}
        {!isDiscount && <p className="mt-3 text-sm text-fg-secondary">Tăng số dư = cộng vào lãi; giảm số dư = trừ khỏi lãi (hiện ở báo cáo Lãi lỗ toàn xưởng, cột &quot;Điều chỉnh công nợ&quot;).</p>}
      </FormCard>
    </NewPage>
  );
}
