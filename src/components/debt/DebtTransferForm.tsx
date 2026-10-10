"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Combobox, FormCard, FormGrid, igArea, igCombo, igInput, InlineField, NewPage, type ComboOption } from "@/components/ui";
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
    <NewPage bare backHref="/accounting/debt-transfers" backLabel="Quay lại danh sách" title="Gộp / chuyển công nợ" submitLabel={merge ? "Gộp mã" : "Chuyển công nợ"} isDirty={() => Boolean(from || to || amount || note)} onSubmit={submit}>
      <FormCard icon={ArrowLeftRight} title="Thông tin chuyển công nợ">
        <FormGrid cols={2}>
          <InlineField id="kind" label="Hình thức" required className="md:col-span-2">
            <select id="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={`${igInput} cursor-pointer`}>
              <option value="TRANSFER">Chuyển một phần số dư</option><option value="MERGE">Gộp mã (chuyển toàn bộ, ngừng mã cũ)</option>
            </select>
          </InlineField>
          <InlineField id="from" label={merge ? "Mã cần gộp (sẽ ngừng)" : "Bên chuyển (giảm số dư)"} required labelClass="sm:min-w-44">
            <div className={igCombo}><Combobox hideLabel label={merge ? "Mã cần gộp (sẽ ngừng)" : "Bên chuyển (giảm số dư)"} value={from} loadOptions={load} placeholder="Tìm đối tác…" onChange={setFrom} /></div>
          </InlineField>
          <InlineField id="to" label={merge ? "Mã giữ lại" : "Bên nhận (tăng số dư)"} required labelClass="sm:min-w-44">
            <div className={igCombo}><Combobox hideLabel label={merge ? "Mã giữ lại" : "Bên nhận (tăng số dư)"} value={to} loadOptions={load} placeholder="Tìm đối tác…" onChange={setTo} /></div>
          </InlineField>
          {!merge && (
            <InlineField id="amount" label="Số tiền" required>
              <input id="amount" type="number" min={0} step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${igInput} tabular text-right`} />
            </InlineField>
          )}
          <InlineField id="date" label="Ngày" required>
            <input id="date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={igInput} />
          </InlineField>
          <InlineField id="note" label="Ghi chú" multiline className="md:col-span-2">
            <textarea id="note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={igArea} />
          </InlineField>
        </FormGrid>
        {merge && <p className="mt-3 text-sm text-fg-secondary">Chứng từ cũ vẫn nằm ở mã cũ để tra cứu; số dư và chiết khấu tích lũy chuyển hết sang mã giữ lại. Mã giữ lại phải có đủ vai trò (khách/NCC) của mã cần gộp.</p>}
      </FormCard>
    </NewPage>
  );
}
