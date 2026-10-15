"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Field, inputClass, NewPage, type ComboOption } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { purchaseInputSchema, type PurchaseInput } from "@/server/purchase/schemas";
import { dropEmptyPurchaseLines, emptyPurchaseLine, PurchaseHeaderFields, PurchaseLinesFields, PurchaseNoteField } from "./PurchaseFormFields";

type PayAccount = ComboOption & { type: "CASH" | "BANK" };
const num = (v: string) => Number(v) || 0;

/** Lập phiếu nhập: một trang — thông tin chung, danh sách sản phẩm, thanh toán NCC (tiền mặt + chuyển khoản, phần còn lại ghi nợ), ghi chú. */
export function PurchaseNewForm({ today, supplierGroups, payAccounts }: { today: string; supplierGroups?: ComboOption[]; payAccounts?: PayAccount[] }) {
  const router = useRouter(), idem = useIdempotencyKey();
  const form = useForm<PurchaseInput>({ resolver: zodResolver(purchaseInputSchema), defaultValues: { partnerId: undefined, date: today, freightCost: 0, note: "", lines: [emptyPurchaseLine] } });
  const cashList = (payAccounts ?? []).filter((a) => a.type === "CASH"), bankList = (payAccounts ?? []).filter((a) => a.type === "BANK");
  const [cashAmount, setCashAmount] = useState(""), [cashAccount, setCashAccount] = useState<number | "">(cashList[0] ? Number(cashList[0].value) : "");
  const [bankAmount, setBankAmount] = useState(""), [bankAccount, setBankAccount] = useState<number | "">(bankList[0] ? Number(bankList[0].value) : "");
  const lines = form.watch("lines");
  const goodsTotal = lines.reduce((s, l) => s + (Number(l?.qty) || 0) * (Number(l?.purchasePrice) || 0), 0);
  const paid = num(cashAmount) + num(bankAmount);

  const submit = form.handleSubmit(async (input) => {
    if (paid > goodsTotal + 0.004) throw new Error("Số tiền trả vượt tiền hàng của phiếu nhập.");
    if (num(cashAmount) > 0 && cashAccount === "") throw new Error("Chọn quỹ tiền mặt.");
    if (num(bankAmount) > 0 && bankAccount === "") throw new Error("Chọn tài khoản ngân hàng.");
    const payments = [
      ...(num(cashAmount) > 0 ? [{ amount: num(cashAmount), cashAccountId: Number(cashAccount) }] : []),
      ...(num(bankAmount) > 0 ? [{ amount: num(bankAmount), cashAccountId: Number(bankAccount) }] : []),
    ];
    const result = await apiFetch<{ id: number }>("/api/purchases", { method: "POST", json: payments.length ? { ...input, payments } : input, idempotencyKey: idem.key });
    router.replace(`/purchase/orders/${result.id}`);
  });
  const accountSelect = (id: string, list: PayAccount[], value: number | "", set: (v: number | "") => void) => (
    <select id={id} value={value} onChange={(e) => set(e.target.value ? Number(e.target.value) : "")} className={inputClass()}>
      <option value="">{list.length ? "— Chọn —" : "Chưa có tài khoản phù hợp"}</option>
      {list.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
    </select>
  );
  return (
    <NewPage backHref="/purchase/orders" backLabel="Quay lại phiếu nhập" title="Lập phiếu nhập" submitLabel="Lập phiếu" isDirty={() => form.formState.isDirty} onSubmit={async () => { dropEmptyPurchaseLines(form); await submit(); }}>
      <div className="space-y-6">
        <div className="space-y-5"><PurchaseHeaderFields form={form} maxDate={today} supplierGroups={supplierGroups} /><PurchaseNoteField form={form} /></div>
        <div className="space-y-3 border-t border-border pt-5">
          <h2 className="text-sm font-semibold">Danh sách sản phẩm</h2>
          <PurchaseLinesFields form={form} />
        </div>
        {payAccounts && (
          <section className="space-y-3 border-t border-border pt-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Wallet size={16} aria-hidden className="text-accent" /> Thanh toán nhà cung cấp</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field id="pay-cash-amount" label="Trả tiền mặt"><input id="pay-cash-amount" type="number" min={0} step="any" value={cashAmount} placeholder="0" onChange={(e) => setCashAmount(e.target.value)} className={`${inputClass()} tabular text-right`} /></Field>
              <Field id="pay-cash-account" label="Quỹ tiền mặt">{accountSelect("pay-cash-account", cashList, cashAccount, setCashAccount)}</Field>
              <Field id="pay-bank-amount" label="Trả chuyển khoản"><input id="pay-bank-amount" type="number" min={0} step="any" value={bankAmount} placeholder="0" onChange={(e) => setBankAmount(e.target.value)} className={`${inputClass()} tabular text-right`} /></Field>
              <Field id="pay-bank-account" label="Ngân hàng">{accountSelect("pay-bank-account", bankList, bankAccount, setBankAccount)}</Field>
            </div>
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex gap-2"><dt className="text-fg-muted">Tiền hàng:</dt><dd className="font-semibold tabular">{formatCurrency(goodsTotal)}</dd></div>
              <div className="flex gap-2"><dt className="text-fg-muted">Đã trả:</dt><dd className="font-semibold tabular">{formatCurrency(paid)}</dd></div>
              <div className="flex gap-2"><dt className="text-fg-muted">{paid > goodsTotal ? "Trả thừa:" : "Ghi nợ NCC:"}</dt><dd className={`font-semibold tabular ${paid > goodsTotal ? "text-danger" : ""}`}>{formatCurrency(Math.abs(goodsTotal - paid))}</dd></div>
            </dl>
            <p className="text-xs text-fg-muted">Phần chưa trả được ghi nợ nhà cung cấp. Cước vận chuyển tính riêng, không nằm trong khoản này.</p>
          </section>
        )}
      </div>
    </NewPage>
  );
}
