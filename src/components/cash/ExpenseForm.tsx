"use client";

import { Receipt } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormCard, FormGrid, igArea, igInput, InlineField, NewPage } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";

export interface ExpenseFormInitial { expenseTypeId: number; cashAccountId: number; amount: string; date: string; note: string }

/** Lập / sửa chi phí hoạt động (66): lương, dầu, điện, sửa xe… Mỗi khoản là một phiếu chi (sổ quỹ ra, không đụng công nợ). */
export function ExpenseForm({ id, code, today, types, accounts, initial }: { id?: number; code?: string; today: string; types: { id: number; name: string }[]; accounts: { id: number; name: string; type: "CASH" | "BANK" }[]; initial?: ExpenseFormInitial }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const editing = id !== undefined;
  const [typeId, setTypeId] = useState<number | "">(initial?.expenseTypeId ?? "");
  const [accountId, setAccountId] = useState<number>(initial?.cashAccountId ?? accounts[0]?.id ?? 0);
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [note, setNote] = useState(initial?.note ?? "");

  async function submit() {
    if (typeId === "") throw new Error("Chọn loại chi phí.");
    if (!(Number(amount) > 0)) throw new Error("Nhập số tiền lớn hơn 0.");
    const body = { expenseTypeId: typeId, cashAccountId: accountId, amount: Number(amount), date, note };
    if (editing) await apiFetch(`/api/expenses/${id}`, { method: "PATCH", json: body });
    else await apiFetch("/api/expenses", { method: "POST", json: body, idempotencyKey: idem.key });
    router.replace("/accounting/expenses");
  }
  return (
    <NewPage bare backHref="/accounting/expenses" backLabel="Quay lại danh sách" title={editing ? `Sửa chi phí ${code}` : "Lập chi phí"} submitLabel={editing ? "Lưu thay đổi" : "Lưu chi phí"} isDirty={() => Boolean(amount || note)} onSubmit={submit}
      footerInfo={amount ? <span className="text-sm font-semibold">Số tiền: <b className="ml-1 text-lg text-accent tabular">{Number(amount).toLocaleString("vi-VN")}</b></span> : undefined}>
      {types.length === 0 && <p role="status" className="rounded-sm border border-warning bg-warning-soft p-3 text-sm">Chưa có loại chi phí nào — tạo ở Hệ thống → Cài đặt danh mục → Loại chi phí.</p>}
      <FormCard icon={Receipt} title="Thông tin chi phí">
        <FormGrid cols={2}>
          <InlineField id="etype" label="Loại chi phí" required>
            <select id="etype" value={typeId} onChange={(e) => setTypeId(e.target.value ? Number(e.target.value) : "")} className={`${igInput} cursor-pointer`}>
              <option value="">Chọn loại…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </InlineField>
          <InlineField id="date" label="Ngày" required><input id="date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={igInput} /></InlineField>
          <InlineField id="account" label="Chi từ quỹ / tài khoản" required>
            <select id="account" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))} className={`${igInput} cursor-pointer`}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.type === "BANK" ? " (ngân hàng)" : ""}</option>)}</select>
          </InlineField>
          <InlineField id="amount" label="Số tiền" required><input id="amount" type="number" min={0} step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${igInput} tabular text-right`} /></InlineField>
          <InlineField id="note" label="Ghi chú" multiline className="md:col-span-2"><textarea id="note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={igArea} /></InlineField>
        </FormGrid>
      </FormCard>
    </NewPage>
  );
}
