"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { Banknote, Package, Undo2 } from "lucide-react";
import { addPickedLines, Combobox, FormCard, FormGrid, igArea, igCombo, igInput, InlineField, inputClass, NewPage, ProductMultiPicker, useLineEntry, type ComboOption, NumberInput, RhfNumberInput } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { ProductOption } from "@/server/products/queries";
import type { ReturnPricingDTO } from "@/server/returns/pricing";
import { returnByProductSchema, type ReturnByProductInput } from "@/server/returns/schemas";

const emptyLine = { productId: undefined, unit: "", qty: undefined, unitPrice: undefined } as unknown as ReturnByProductInput["lines"][number];
const num = (v: unknown) => Number(v) || 0;

const COPY = {
  BY_PRODUCT: {
    title: "Khách trả theo sản phẩm", partnerLabel: "Khách hàng", partnerPlaceholder: "Tìm khách hàng…", search: "customers", endpoint: "/api/returns/by-product", kind: "CUSTOMER",
    priceLabel: "Giá trừ công nợ", totalLabel: "Trừ công nợ khách", back: "/returns/by-product", hint: "Nhập lại kho theo vốn lần bán gần nhất cho khách (không có thì giá nhập gần nhất).",
  },
  SUPPLIER: {
    title: "Trả nhà cung cấp", partnerLabel: "Nhà cung cấp", partnerPlaceholder: "Tìm nhà cung cấp…", search: "suppliers", endpoint: "/api/returns/to-supplier", kind: "SUPPLIER",
    priceLabel: "Giá thỏa thuận", totalLabel: "Giảm công nợ phải trả", back: "/returns/to-supplier", hint: "Xuất kho theo FIFO (lô cũ nhất trước). Giá thỏa thuận mặc định là giá nhập gần nhất.",
  },
} as const;

/** Trả theo sản phẩm (45) và trả NCC (47). Giá gợi ý điền vào ô giá còn trống, sửa tay được. */
export function ReturnByProductForm({ mode, today, refundAccounts }: { mode: "BY_PRODUCT" | "SUPPLIER"; today: string; /** Chỉ khách trả: quỹ/ngân hàng để hoàn tiền (thiếu quyền chi ⇒ không có ô hoàn tiền). */ refundAccounts?: (ComboOption & { type: "CASH" | "BANK" })[] }) {
  const c = COPY[mode];
  const router = useRouter();
  const idem = useIdempotencyKey();
  const form = useForm<ReturnByProductInput>({ resolver: zodResolver(returnByProductSchema), defaultValues: { partnerId: undefined, date: today, note: "", lines: [emptyLine] } });
  const { control, register, handleSubmit, setValue, getValues, watch, formState: { errors, isDirty } } = form;
  const { fields, append, remove, update } = useFieldArray({ control, name: "lines", keyName: "_key" });
  const lines = watch("lines");
  const partnerId = watch("partnerId");
  const [partner, setPartner] = useState<ComboOption | null>(null);
  const [products, setProducts] = useState(() => new Map<number, ProductOption>());
  const [pricing, setPricing] = useState(() => new Map<string, ReturnPricingDTO | null>());
  const requested = useRef(new Set<string>());
  const key = (productId: number) => `${partnerId}:${productId}`;

  useEffect(() => {
    if (!partnerId) return;
    for (const l of lines) {
      const pid = l?.productId;
      if (!pid || requested.current.has(key(pid))) continue;
      requested.current.add(key(pid));
      apiFetch<ReturnPricingDTO | null>(`/api/returns/pricing?kind=${c.kind}&partnerId=${partnerId}&productId=${pid}`)
        .then((dto) => setPricing((m) => new Map(m).set(key(pid), dto))).catch(() => requested.current.delete(key(pid)));
    }
  }, [partnerId, lines.map((l) => l?.productId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    lines.forEach((l, i) => {
      const dto = l?.productId && partnerId ? pricing.get(key(l.productId)) : null;
      const suggested = dto?.units.find((u) => u.unit === l.unit)?.suggestedPrice;
      if (suggested != null && !num(getValues(`lines.${i}.unitPrice`))) setValue(`lines.${i}.unitPrice`, Number(suggested), { shouldValidate: true });
    });
  }, [pricing, partnerId, lines.map((l) => `${l?.productId}:${l?.unit}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Khấu trừ (phí vận chuyển…) + hoàn tiền khách bằng tiền mặt / chuyển khoản; phần còn lại trừ vào công nợ
  const customerMode = mode === "BY_PRODUCT";
  const [dedAmount, setDedAmount] = useState(""), [dedReason, setDedReason] = useState("");
  const cashList = (refundAccounts ?? []).filter((a) => a.type === "CASH"), bankList = (refundAccounts ?? []).filter((a) => a.type === "BANK");
  const [cashRefund, setCashRefund] = useState(""), [cashAcc, setCashAcc] = useState<number | "">(cashList[0] ? Number(cashList[0].value) : "");
  const [bankRefund, setBankRefund] = useState(""), [bankAcc, setBankAcc] = useState<number | "">(bankList[0] ? Number(bankList[0].value) : "");
  const submit = handleSubmit(async (value) => {
    const body: Record<string, unknown> = { ...value };
    if (customerMode) {
      const goods = lines.reduce((s, l) => s + amountOf(l), 0);
      const net = Math.round((goods - num(dedAmount)) * 100) / 100;
      if (num(dedAmount) > 0) body.deduction = { amount: num(dedAmount), reason: dedReason.trim() };
      if (num(dedAmount) > goods + 0.004) throw new Error("Khoản khấu trừ vượt giá trị hàng trả.");
      if (num(cashRefund) + num(bankRefund) > net + 0.004) throw new Error("Số tiền hoàn vượt giá trị hàng trả sau khấu trừ.");
      if (num(cashRefund) > 0 && cashAcc === "") throw new Error("Chọn quỹ tiền mặt để hoàn tiền.");
      if (num(bankRefund) > 0 && bankAcc === "") throw new Error("Chọn tài khoản ngân hàng để hoàn tiền.");
      const refunds = [...(num(cashRefund) > 0 ? [{ amount: num(cashRefund), cashAccountId: Number(cashAcc) }] : []), ...(num(bankRefund) > 0 ? [{ amount: num(bankRefund), cashAccountId: Number(bankAcc) }] : [])];
      if (refunds.length) body.refunds = refunds;
    }
    const r = await apiFetch<{ id: number }>(c.endpoint, { method: "POST", json: body, idempotencyKey: idem.key });
    router.replace(`/returns/${r.id}`);
  });
  const loadPartners = (q: string) => apiFetch<ComboOption[]>(`/api/partner-lists/${c.search}/search?q=${encodeURIComponent(q)}`);
  const loadProducts = async (q: string) => {
    const rows = await apiFetch<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(q)}`);
    setProducts((m) => new Map([...m, ...rows.map((r) => [r.value, r] as const)]));
    return rows;
  };
  const amountOf = (l: (typeof lines)[number] | undefined) => Math.round(num(l?.qty) * num(l?.unitPrice) * 100) / 100;
  const entry = useLineEntry({ count: fields.length, getLines: () => getValues("lines"), append, remove, blank: emptyLine, qtyLabel: (i) => `Số lượng dòng ${i + 1}` });
  const addProducts = (picked: ProductOption[]) => {
    setProducts((m) => new Map([...m, ...picked.map((p) => [p.value, p] as const)]));
    addPickedLines(picked, getValues("lines"), (p) => ({ ...emptyLine, productId: p.value, unit: p.baseUnit }), { update, append: (vs) => append(vs) });
  };
  const total = lines.reduce((s, l) => s + amountOf(l), 0);

  return (
    <NewPage wide bare backHref={c.back} backLabel="Quay lại danh sách" title={c.title} submitLabel="Lập phiếu trả" isDirty={() => isDirty} onSubmit={async () => { entry.dropEmptyLines(); await submit(); }}
      footerInfo={<span className="text-sm font-semibold">{c.totalLabel}: <b className="ml-1 text-lg text-accent tabular">{formatCurrency(total)}</b></span>}>
      <FormCard icon={Undo2} title="Thông tin trả hàng">
        <p className="mb-3 text-sm text-fg-secondary">{c.hint}</p>
        <FormGrid cols={2}>
          <InlineField id="partnerId" label={c.partnerLabel} required error={errors.partnerId?.message}>
            <Controller control={control} name="partnerId" render={({ field }) => (
              <div className={igCombo}><Combobox hideLabel label={c.partnerLabel} value={field.value ? partner : null} loadOptions={loadPartners} placeholder={c.partnerPlaceholder}
                onChange={(o) => { setPartner(o); field.onChange(o ? Number(o.value) : undefined); }} /></div>
            )} />
          </InlineField>
          <InlineField id="date" label="Ngày trả" required error={errors.date?.message}>
            <input id="date" type="date" max={today} {...register("date")} aria-invalid={!!errors.date} className={igInput} />
          </InlineField>
          <InlineField id="note" label="Ghi chú" multiline error={errors.note?.message} className="md:col-span-2">
            <textarea id="note" rows={3} {...register("note")} className={igArea} />
          </InlineField>
        </FormGrid>
      </FormCard>
      <FormCard icon={Package} title="Dòng hàng trả">
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-sm border border-border">
            <table className="line-table w-full min-w-[760px] text-sm">
              <thead><tr className="border-b border-border bg-hover text-left text-xs font-semibold text-fg-secondary">
                <th className="px-2 py-2">Sản phẩm</th><th className="px-2 py-2">ĐVT</th><th className="px-2 py-2 text-right">SL</th><th className="px-2 py-2 text-right">{c.priceLabel}</th><th className="px-2 py-2 text-right">Thành tiền</th><th aria-label="Thao tác" />
              </tr></thead>
              <tbody>
                {fields.map((field, index) => {
                  const l = lines[index]; const err = errors.lines?.[index];
                  const product = l?.productId ? products.get(l.productId) ?? null : null;
                  const dup = l?.productId ? lines.findIndex((o, i) => i < index && o?.productId === l.productId && o?.unit === l.unit) + 1 : 0;
                  return (
                    <tr key={field._key} className="border-b border-border align-top last:border-b-0">
                      <td className="min-w-64 px-2 py-2" data-line-product={index} data-label="Sản phẩm" data-wide>
                        <Controller control={control} name={`lines.${index}.productId`} render={({ field: f }) => (
                          <Combobox label={`Sản phẩm dòng ${index + 1}`} value={product} loadOptions={loadProducts} placeholder="Tìm mã, tên…" error={err?.productId?.message}
                            onChange={(o) => {
                              const p = o as ProductOption | null;
                              f.onChange(p ? Number(p.value) : undefined);
                              if (p) setProducts((m) => new Map(m).set(p.value, p));
                              setValue(`lines.${index}.unit`, p?.baseUnit ?? "", { shouldValidate: true });
                              setValue(`lines.${index}.unitPrice`, undefined as never);
                              if (p) entry.onProductPicked(index);
                            }} />
                        )} />
                        {dup > 0 && <p role="status" className="mt-1 text-xs font-medium text-warning">Sản phẩm này đã có ở dòng {dup}</p>}
                      </td>
                      <td className="px-2 py-2" data-label="ĐVT">
                        <select aria-label={`Đơn vị dòng ${index + 1}`} value={l?.unit ?? ""} className={`${inputClass(err?.unit)} min-w-20`}
                          onChange={(e) => { setValue(`lines.${index}.unit`, e.target.value, { shouldValidate: true, shouldDirty: true }); setValue(`lines.${index}.unitPrice`, undefined as never); }}>
                          <option value="">—</option>{(product?.units ?? []).map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2" data-label="Số lượng"><RhfNumberInput aria-label={`Số lượng dòng ${index + 1}`} maxFrac={3} control={control} name={`lines.${index}.qty`} onKeyDown={entry.onQtyKeyDown(index)} className={`${inputClass(err?.qty)} min-w-20 tabular text-right`} /></td>
                      <td className="px-2 py-2" data-label={c.priceLabel}><RhfNumberInput aria-label={`Đơn giá dòng ${index + 1}`} maxFrac={2} control={control} name={`lines.${index}.unitPrice`} className={`${inputClass(err?.unitPrice)} min-w-28 tabular text-right`} /></td>
                      <td className="px-2 py-2 text-right tabular" data-label="Thành tiền">{formatCurrency(amountOf(l))}</td>
                      <td className="px-2 py-2" data-action><button type="button" aria-label={`Xóa dòng ${index + 1}`} onClick={() => remove(index)} disabled={fields.length === 1} className="h-11 w-11 text-danger hover:bg-danger-soft disabled:opacity-40 md:h-9 md:w-9">×</button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr className="border-t-2 border-border bg-hover font-semibold"><td colSpan={4} className="px-2 py-3 text-right">{c.totalLabel}</td><td className="px-2 py-3 text-right tabular">{formatCurrency(total)}</td><td /></tr></tfoot>
            </table>
          </div>
          {errors.lines?.message && <p role="alert" className="text-sm text-danger">{errors.lines.message}</p>}
          {customerMode && (() => {
            const net = Math.round((total - num(dedAmount)) * 100) / 100, refunded = num(cashRefund) + num(bankRefund);
            const sel = (id: string, list: (ComboOption & { type: string })[], value: number | "", set: (v: number | "") => void) => (
              <select id={id} value={value} onChange={(e) => set(e.target.value ? Number(e.target.value) : "")} className={`${igInput} cursor-pointer`}>
                <option value="">{list.length ? "— Chọn —" : "Chưa có tài khoản phù hợp"}</option>{list.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            );
            const money = "tabular text-right";
            const ig = (cls: string) => `${igInput} ${cls}`;
            return (
              <FormCard icon={Banknote} title="Xử lý tiền khi khách trả hàng">
                <FormGrid cols={2}>
                  <InlineField id="ret-ded" label="Khấu trừ" labelClass="sm:min-w-40" hint="Phí vận chuyển, hao hụt… trừ vào tiền khách được nhận lại"><NumberInput id="ret-ded" value={dedAmount} placeholder="0" onValueChange={setDedAmount} className={ig(money)} /></InlineField>
                  <InlineField id="ret-ded-reason" label="Lý do khấu trừ" labelClass="sm:min-w-40"><input id="ret-ded-reason" maxLength={200} value={dedReason} onChange={(e) => setDedReason(e.target.value)} className={igInput} /></InlineField>
                  {refundAccounts && (<>
                    <InlineField id="ret-cash" label="Hoàn tiền mặt" labelClass="sm:min-w-40"><NumberInput id="ret-cash" value={cashRefund} placeholder="0" onValueChange={setCashRefund} className={ig(money)} /></InlineField>
                    <InlineField id="ret-cash-acc" label="Quỹ tiền mặt" labelClass="sm:min-w-40">{sel("ret-cash-acc", cashList, cashAcc, setCashAcc)}</InlineField>
                    <InlineField id="ret-bank" label="Hoàn chuyển khoản" labelClass="sm:min-w-40"><NumberInput id="ret-bank" value={bankRefund} placeholder="0" onValueChange={setBankRefund} className={ig(money)} /></InlineField>
                    <InlineField id="ret-bank-acc" label="Ngân hàng" labelClass="sm:min-w-40">{sel("ret-bank-acc", bankList, bankAcc, setBankAcc)}</InlineField>
                  </>)}
                </FormGrid>
                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <div className="flex gap-2"><dt className="text-fg-muted">Giá trị hàng trả:</dt><dd className="font-semibold tabular">{formatCurrency(total)}</dd></div>
                  <div className="flex gap-2"><dt className="text-fg-muted">Sau khấu trừ:</dt><dd className="font-semibold tabular">{formatCurrency(net)}</dd></div>
                  <div className="flex gap-2"><dt className="text-fg-muted">Hoàn lại khách:</dt><dd className="font-semibold tabular">{formatCurrency(refunded)}</dd></div>
                  <div className="flex gap-2"><dt className="text-fg-muted">Trừ vào công nợ:</dt><dd className={`font-semibold tabular ${refunded > net ? "text-danger" : ""}`}>{formatCurrency(net - refunded)}</dd></div>
                </dl>
              </FormCard>
            );
          })()}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => append(emptyLine)} className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover md:h-10">+ Thêm dòng</button>
            <ProductMultiPicker load={loadProducts} existingIds={lines.flatMap((l) => (l?.productId ? [l.productId] : []))} onPicked={addProducts} />
          </div>
        </div>
      </FormCard>
    </NewPage>
  );
}
