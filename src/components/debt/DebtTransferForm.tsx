"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, Field, inputClass, NewPage, type ComboOption } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";

/** Gộp / chuyển công nợ (65). Gộp mã: chuyển TOÀN BỘ số dư + chiết khấu tích lũy rồi ngừng mã cũ. */
export function DebtTransferForm({ today }: { today: string }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [kind, setKind] = useState<"TRANSFER" | "MERGE">("TRANSFER");
  const [from, setFrom] = useState<ComboOption | null>(null);
  const [to, setTo] = useState<ComboOption | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const merge = kind === "MERGE";

  async function submit() {
    if (!from || !to) throw new Error(merge ? "Chọn mã cần gộp và mã giữ lại." : "Chọn bên chuyển và bên nhận.");
    if (!merge && !(Number(amount) > 0)) throw new Error("Nhập số tiền lớn hơn 0.");
    const base = { fromPartnerId: Number(from.value), toPartnerId: Number(to.value), date, note };
    await apiFetch("/api/debts/transfers", { method: "POST", json: merge ? { kind, ...base } : { kind, ...base, amount: Number(amount) }, idempotencyKey: idem.key });
    router.replace("/accounting/debt-transfers");
  }
  const load = (q: string) => apiFetch<ComboOption[]>(`/api/debts/partners?q=${encodeURIComponent(q)}`);

  return (
    <NewPage backHref="/accounting/debt-transfers" backLabel="Quay lại danh sách" title="Gộp / chuyển công nợ" submitLabel={merge ? "Gộp mã" : "Chuyển công nợ"} isDirty={() => Boolean(from || to || amount || note)} onSubmit={submit}>
      <div className="space-y-5">
        <Field id="kind" label="Hình thức" required>
          <select id="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inputClass()}>
            <option value="TRANSFER">Chuyển một phần số dư</option><option value="MERGE">Gộp mã (chuyển toàn bộ, ngừng mã cũ)</option>
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Combobox label={merge ? "Mã cần gộp (sẽ ngừng)" : "Bên chuyển (giảm số dư)"} value={from} loadOptions={load} placeholder="Tìm đối tác…" onChange={setFrom} />
          <Combobox label={merge ? "Mã giữ lại" : "Bên nhận (tăng số dư)"} value={to} loadOptions={load} placeholder="Tìm đối tác…" onChange={setTo} />
          {!merge && (
            <Field id="amount" label="Số tiền" required>
              <input id="amount" type="number" min={0} step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass()} tabular`} />
            </Field>
          )}
          <Field id="date" label="Ngày" required>
            <input id="date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={inputClass()} />
          </Field>
        </div>
        {merge && <p className="text-sm text-fg-secondary">Chứng từ cũ vẫn nằm ở mã cũ để tra cứu; số dư và chiết khấu tích lũy chuyển hết sang mã giữ lại. Mã giữ lại phải có đủ vai trò (khách/NCC) của mã cần gộp.</p>}
        <Field id="note" label="Ghi chú">
          <textarea id="note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" />
        </Field>
      </div>
    </NewPage>
  );
}
