"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, Field, inputClass, NewPage, type ComboOption } from "@/components/ui";
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
    <NewPage backHref="/accounting/debt-adjustments" backLabel="Quay lại danh sách" title="Điều chỉnh công nợ" submitLabel="Lưu điều chỉnh" isDirty={() => Boolean(amount || note)} onSubmit={submit}>
      <div className="space-y-5">
        <Combobox label="Đối tác" value={p} loadOptions={load} placeholder="Tìm khách / nhà cung cấp…" onChange={setP} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="reason" label="Lý do" required>
            <select id="reason" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className={inputClass()}>
              {DEBT_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </select>
          </Field>
          <Field id="direction" label="Tác động lên số dư" required>
            <select id="direction" value={reason === "CHIET_KHAU" ? "DECREASE" : direction} disabled={reason === "CHIET_KHAU"} onChange={(e) => setDirection(e.target.value as typeof direction)} className={inputClass()}>
              <option value="DECREASE">Giảm số dư (giảm nợ)</option><option value="INCREASE">Tăng số dư (tăng nợ)</option>
            </select>
          </Field>
          <Field id="amount" label="Số tiền" required>
            <input id="amount" type="number" min={0} step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass()} tabular`} />
          </Field>
          <Field id="date" label="Ngày" required>
            <input id="date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={inputClass()} />
          </Field>
        </div>
        {reason === "CHIET_KHAU" && <p className="text-sm text-fg-secondary">Trừ nợ bằng chiết khấu tích lũy: số tiền tiêu hao số dư chiết khấu của đối tác, không vượt số dư còn.</p>}
        <Field id="note" label="Ghi chú" required>
          <textarea id="note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" />
        </Field>
      </div>
    </NewPage>
  );
}
