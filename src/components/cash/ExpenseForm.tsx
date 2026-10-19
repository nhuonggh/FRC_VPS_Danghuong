"use client";

import { Receipt } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, type ComboOption, FormCard, FormGrid, igCombo, igArea, igInput, InlineField, NewPage, NumberInput } from "@/components/ui";
import { filterComboOptions } from "@/components/ui/Combobox";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";

export interface ExpenseFormInitial { advancedBy?: ComboOption | null; expenseTypeId: number; cashAccountId: number; amount: string; date: string; note: string }

/** Lập / sửa chi phí hoạt động (66): lương, dầu, điện, sửa xe… Mỗi khoản là một phiếu chi (sổ quỹ ra, không đụng công nợ). */
export function ExpenseForm({ id, code, today, types, accounts, initial, people = [] }: { people?: ComboOption[]; id?: number; code?: string; today: string; types: { id: number; name: string }[]; accounts: { id: number; name: string; type: "CASH" | "BANK" }[]; initial?: ExpenseFormInitial }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const editing = id !== undefined;
  const [typeId, setTypeId] = useState<number | "">(initial?.expenseTypeId ?? "");
  const [accountId, setAccountId] = useState<number>(initial?.cashAccountId ?? accounts[0]?.id ?? 0);
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [advancedBy, setAdvancedBy] = useState<ComboOption | null>(initial?.advancedBy ?? null);
  const [note, setNote] = useState(initial?.note ?? "");

  async function submit() {
    if (typeId === "") throw new Error("Chọn loại chi phí.");
    if (!accountId) throw new Error("Chọn quỹ/tài khoản.");
    if (!(Number(amount) > 0)) throw new Error("Nhập số tiền lớn hơn 0.");
    const body = { advancedById: advancedBy ? Number(advancedBy.value) : null, expenseTypeId: typeId, cashAccountId: accountId, amount: Number(amount), date, note };
    if (editing) await apiFetch(`/api/expenses/${id}`, { method: "PATCH", json: body });
    else await apiFetch("/api/expenses", { method: "POST", json: body, idempotencyKey: idem.key });
    router.replace("/accounting/expenses");
  }
  return (
    <NewPage wide backHref="/accounting/expenses" backLabel="Quay lại danh sách" title={editing ? `Sửa chi phí ${code}` : "Lập chi phí"} submitLabel={editing ? "Lưu thay đổi" : "Lưu chi phí"} isDirty={() => Boolean(amount || note || advancedBy || typeId !== (initial?.expenseTypeId ?? "") || accountId !== (initial?.cashAccountId ?? accounts[0]?.id ?? 0) || date !== (initial?.date ?? today))} onSubmit={submit}
      footerInfo={amount ? <span className="text-sm font-semibold">Số tiền: <b className="ml-1 text-lg text-accent tabular">{Number(amount).toLocaleString("vi-VN")}</b></span> : undefined}>
      {types.length === 0 && <p role="status" className="rounded-sm border border-warning bg-warning-soft p-3 text-sm">Chưa có loại chi phí nào — tạo ở Hệ thống → Cài đặt danh mục → Loại chi phí.</p>}
      <FormCard icon={Receipt} title="Thông tin chi phí">
        <FormGrid cols={2}>
          <InlineField id="etype" label="Loại chi phí" required>
            <div className={igCombo}><Combobox hideLabel label="Loại chi phí" value={types.find(t => t.id === typeId) ? { value: typeId, label: types.find(t => t.id === typeId)!.name } : null} onChange={o => setTypeId(o ? Number(o.value) : "")} loadOptions={async q => filterComboOptions(types.map(t => ({ value: t.id, label: t.name })), q)} placeholder="Chọn loại chi phí…" /></div>
          </InlineField>
          <InlineField id="date" label="Ngày" required><input id="date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={igInput} /></InlineField>
          <InlineField id="account" label="Chi từ quỹ / tài khoản" required>
            <div className={igCombo}><Combobox hideLabel label="Chi từ quỹ / tài khoản" value={accounts.find(a => a.id === accountId) ? { value: accountId, label: accounts.find(a => a.id === accountId)!.name } : null} onChange={o => setAccountId(o ? Number(o.value) : 0)} loadOptions={async q => filterComboOptions(accounts.map(a => ({ value: a.id, label: a.name, hint: a.type === "BANK" ? "Ngân hàng" : "Tiền mặt" })), q)} /></div>
          </InlineField>
          <InlineField id="amount" label="Số tiền" required><NumberInput id="amount" value={amount} onValueChange={setAmount} className={`${igInput} tabular text-right`} /></InlineField>
          <InlineField id="advancedBy" label="Người ứng tiền" className="md:col-span-2"><div className={igCombo}><Combobox hideLabel label="Người ứng tiền" value={advancedBy} onChange={setAdvancedBy} loadOptions={async q => filterComboOptions(people, q)} placeholder="Tìm và chọn người ứng tiền…" /></div></InlineField>
          <InlineField id="note" label="Ghi chú" multiline className="md:col-span-2"><textarea id="note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={igArea} /></InlineField>
        </FormGrid>
      </FormCard>
    </NewPage>
  );
}
