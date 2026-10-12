"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Scale } from "lucide-react";
import { Combobox, FormCard, FormGrid, igArea, igCombo, igInput, InlineField, NewPage, type ComboOption, NumberInput } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
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

  async function submit() {
    if (!p) throw new Error("Chọn đối tác.");
    if (!(Number(amount) > 0)) throw new Error("Nhập số tiền lớn hơn 0.");
    if (!note.trim()) throw new Error("Nhập ghi chú.");
    await apiFetch("/api/debts/adjustments", { method: "POST", json: { partnerId: Number(p.value), reason, direction: reason === "CHIET_KHAU" ? "DECREASE" : direction, amount: Number(amount), date, note }, idempotencyKey: idem.key });
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
        {reason === "CHIET_KHAU" && <p className="mt-3 text-sm text-fg-secondary">Trừ nợ bằng chiết khấu tích lũy: số tiền tiêu hao số dư chiết khấu của đối tác, không vượt số dư còn.</p>}
      </FormCard>
    </NewPage>
  );
}
