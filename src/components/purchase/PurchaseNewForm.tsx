"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Package, Truck, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormCard, FormGrid, igInput, InlineField, NewPage, type ComboOption, NumberInput } from "@/components/ui";
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
    <select id={id} value={value} onChange={(e) => set(e.target.value ? Number(e.target.value) : "")} className={`${igInput} cursor-pointer`}>
      <option value="">{list.length ? "— Chọn —" : "Chưa có tài khoản phù hợp"}</option>
      {list.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
    </select>
  );
  return (
    <NewPage wide bare backHref="/purchase/orders" backLabel="Quay lại phiếu nhập" title="Lập phiếu nhập" submitLabel="Lập phiếu" isDirty={() => form.formState.isDirty} onSubmit={async () => { dropEmptyPurchaseLines(form); await submit(); }}
      footerInfo={(
        <>
          <span className="text-sm font-semibold">Tiền hàng: <b className="ml-1 text-lg text-accent tabular">{formatCurrency(goodsTotal)}</b></span>
          {payAccounts && <span className="text-sm font-semibold">{paid > goodsTotal ? "Trả thừa" : "Ghi nợ NCC"}: <b className={`ml-1 text-lg tabular ${paid > goodsTotal ? "text-danger" : "text-accent"}`}>{formatCurrency(Math.abs(goodsTotal - paid))}</b></span>}
        </>
      )}>
      <FormCard icon={Truck} title="Thông tin chung">
        <div className="space-y-3"><PurchaseHeaderFields form={form} maxDate={today} supplierGroups={supplierGroups} /><PurchaseNoteField form={form} /></div>
      </FormCard>
      <FormCard icon={Package} title="Danh sách sản phẩm">
        <PurchaseLinesFields form={form} />
      </FormCard>
      {payAccounts && (
        <FormCard icon={Wallet} title="Thanh toán nhà cung cấp">
          <FormGrid cols={2}>
            <InlineField id="pay-cash-amount" label="Trả tiền mặt" labelClass="sm:min-w-40"><NumberInput id="pay-cash-amount" value={cashAmount} placeholder="0" onValueChange={setCashAmount} className={`${igInput} tabular text-right`} /></InlineField>
            <InlineField id="pay-cash-account" label="Quỹ tiền mặt" labelClass="sm:min-w-40">{accountSelect("pay-cash-account", cashList, cashAccount, setCashAccount)}</InlineField>
            <InlineField id="pay-bank-amount" label="Trả chuyển khoản" labelClass="sm:min-w-40"><NumberInput id="pay-bank-amount" value={bankAmount} placeholder="0" onValueChange={setBankAmount} className={`${igInput} tabular text-right`} /></InlineField>
            <InlineField id="pay-bank-account" label="Ngân hàng" labelClass="sm:min-w-40">{accountSelect("pay-bank-account", bankList, bankAccount, setBankAccount)}</InlineField>
          </FormGrid>
          <p className="mt-3 text-xs text-fg-muted">Phần chưa trả được ghi nợ nhà cung cấp. Cước vận chuyển tính riêng, không nằm trong khoản này.</p>
        </FormCard>
      )}
    </NewPage>
  );
}
