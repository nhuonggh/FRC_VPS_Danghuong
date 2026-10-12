"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { Package, UserRound } from "lucide-react";
import { addPickedLines, Combobox, FormCard, FormGrid, igArea, igCombo, igInput, InlineField, inputClass, NewPage, ProductMultiPicker, useLineEntry, type ComboOption } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { useProcessingOptions } from "@/lib/use-processing-options";
import type { ProductOption } from "@/server/products/queries";
import type { SalePricingDTO } from "@/server/sales/pricing";
import { quoteSchema, type QuoteInput } from "@/server/quotes/schemas";

const emptyLine = { productId: undefined, unit: "", qty: undefined, salePrice: undefined, note: "", processingTypeId: null } as unknown as QuoteInput["lines"][number];
const num = (v: unknown) => Number(v) || 0;

export interface QuoteEdit { quoteId: number; code: string; customer: ComboOption; products: ProductOption[]; defaults: QuoteInput }

/** Lập / sửa báo giá (mã 35). Không kho, không công nợ. Giá gợi ý = giá bán gần nhất (điền vào ô giá còn trống). */
export function QuoteForm({ today, edit }: { today: string; edit?: QuoteEdit }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const form = useForm<QuoteInput>({
    resolver: zodResolver(quoteSchema),
    defaultValues: edit?.defaults ?? { partnerId: undefined, date: today, note: "", lines: [emptyLine] },
  });
  const { control, register, handleSubmit, setValue, getValues, watch, formState: { errors, isDirty } } = form;
  const { fields, append, remove, update } = useFieldArray({ control, name: "lines", keyName: "_key" });
  const lines = watch("lines");
  const partnerId = watch("partnerId");
  const [customer, setCustomer] = useState<ComboOption | null>(edit?.customer ?? null);
  const [products, setProducts] = useState(() => new Map<number, ProductOption>((edit?.products ?? []).map((p) => [p.value, p] as const)));
  const [pricing, setPricing] = useState(() => new Map<string, SalePricingDTO | null>());
  const requested = useRef(new Set<string>());
  const key = (productId: number, typeId?: number | null) => `${partnerId}:${productId}:${typeId ?? 0}`;
  const { options: typeOptions, ensure: ensureTypes } = useProcessingOptions();
  useEffect(() => { for (const l of lines) ensureTypes(l?.productId); }, [lines.map((l) => l?.productId).join(","), ensureTypes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!partnerId) return;
    for (const l of lines) {
      const pid = l?.productId;
      const k = key(pid ?? 0, l?.processingTypeId);
      if (!pid || requested.current.has(k)) continue;
      requested.current.add(k);
      apiFetch<SalePricingDTO | null>(`/api/orders/pricing?partnerId=${partnerId}&productId=${pid}${l?.processingTypeId ? `&processingTypeId=${l.processingTypeId}` : ""}`)
        .then((dto) => setPricing((m) => new Map(m).set(k, dto))).catch(() => requested.current.delete(k));
    }
  }, [partnerId, lines.map((l) => `${l?.productId}:${l?.processingTypeId ?? 0}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    lines.forEach((l, i) => {
      const dto = l?.productId && partnerId ? pricing.get(key(l.productId, l.processingTypeId)) : null;
      const suggested = dto?.units.find((u) => u.unit === l.unit)?.suggestedPrice;
      if (suggested != null && !num(getValues(`lines.${i}.salePrice`))) setValue(`lines.${i}.salePrice`, Number(suggested), { shouldValidate: true });
    });
  }, [pricing, partnerId, lines.map((l) => `${l?.productId}:${l?.unit}:${l?.processingTypeId ?? 0}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = handleSubmit(async (value) => {
    if (edit) {
      await apiFetch(`/api/quotes/${edit.quoteId}`, { method: "PATCH", json: value });
      router.replace(`/sales/quotes/${edit.quoteId}`);
      return;
    }
    const r = await apiFetch<{ id: number }>("/api/quotes", { method: "POST", json: value, idempotencyKey: idem.key });
    router.replace(`/sales/quotes/${r.id}`);
  });
  const loadCustomers = (q: string) => apiFetch<ComboOption[]>(`/api/partner-lists/customers/search?q=${encodeURIComponent(q)}`);
  const loadProducts = async (q: string) => {
    const rows = await apiFetch<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(q)}`);
    setProducts((m) => new Map([...m, ...rows.map((r) => [r.value, r] as const)]));
    return rows;
  };
  const total = lines.reduce((s, l) => s + Math.round(num(l?.qty) * num(l?.salePrice) * 100) / 100, 0);

  const entry = useLineEntry({ count: fields.length, getLines: () => getValues("lines"), append, remove, blank: emptyLine, qtyLabel: (i) => `Số lượng dòng ${i + 1}` });
  const addProducts = (picked: ProductOption[]) => {
    setProducts((m) => new Map([...m, ...picked.map((p) => [p.value, p] as const)]));
    addPickedLines(picked, getValues("lines"), (p) => ({ ...emptyLine, productId: p.value, unit: p.baseUnit }), { update, append: (vs) => append(vs) });
  };

  // Một trang: thông tin chung ở trên, dòng hàng ở dưới.
  return (
    <NewPage wide bare backHref={edit ? `/sales/quotes/${edit.quoteId}` : "/sales/quotes"} backLabel={edit ? `Quay lại báo giá ${edit.code}` : "Quay lại danh sách báo giá"}
      title={edit ? `Sửa báo giá ${edit.code}` : "Lập báo giá"} submitLabel={edit ? "Lưu thay đổi" : "Lập báo giá"} isDirty={() => isDirty} onSubmit={async () => { entry.dropEmptyLines(); await submit(); }}
      footerInfo={<span className="text-sm font-semibold">Tổng báo giá: <b className="ml-1 text-lg text-accent tabular">{formatCurrency(total)}</b></span>}>
      <FormCard icon={UserRound} title="Thông tin báo giá">
        <FormGrid cols={2}>
          <InlineField id="partnerId" label="Khách hàng" required error={errors.partnerId?.message}>
            <Controller control={control} name="partnerId" render={({ field }) => (
              <div className={igCombo}><Combobox hideLabel label="Khách hàng" value={field.value ? customer : null} loadOptions={loadCustomers} placeholder="Tìm khách hàng…"
                onChange={(o) => { setCustomer(o); field.onChange(o ? Number(o.value) : undefined); }} /></div>
            )} />
          </InlineField>
          <InlineField id="date" label="Ngày báo giá" required error={errors.date?.message}>
            <input id="date" type="date" max={today} {...register("date")} aria-invalid={!!errors.date} className={igInput} />
          </InlineField>
          <InlineField id="note" label="Ghi chú" multiline error={errors.note?.message} className="md:col-span-2">
            <textarea id="note" rows={3} {...register("note")} className={igArea} />
          </InlineField>
        </FormGrid>
      </FormCard>
      <FormCard icon={Package} title="Dòng hàng">
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-sm border border-border">
            <table className="line-table w-full min-w-[940px] text-sm">
              <thead><tr className="border-b border-border bg-hover text-left text-xs font-semibold text-fg-secondary">
                <th className="px-2 py-2">Sản phẩm</th><th className="px-2 py-2">Kiểu gia công</th><th className="px-2 py-2">ĐVT</th><th className="px-2 py-2 text-right">SL</th><th className="px-2 py-2 text-right">Đơn giá</th>
                <th className="px-2 py-2 text-right">Thành tiền</th><th className="px-2 py-2">Ghi chú</th><th aria-label="Thao tác" />
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
                              setValue(`lines.${index}.salePrice`, undefined as never);
                              setValue(`lines.${index}.processingTypeId`, null, { shouldDirty: true });
                              ensureTypes(p ? Number(p.value) : undefined);
                              if (p) entry.onProductPicked(index);
                            }} />
                        )} />
                        {dup > 0 && <p role="status" className="mt-1 text-xs font-medium text-warning">Sản phẩm này đã có ở dòng {dup}</p>}
                      </td>
                      <td className="px-2 py-2" data-label="Kiểu gia công">{(typeOptions.get(l?.productId ?? 0) ?? []).length > 0 ? <select aria-label={`Kiểu gia công dòng ${index + 1}`} value={l?.processingTypeId ?? ""} className={`${inputClass()} min-w-28`} onChange={(e) => { setValue(`lines.${index}.processingTypeId`, e.target.value ? Number(e.target.value) : null, { shouldDirty: true }); setValue(`lines.${index}.salePrice`, undefined as never); }}><option value="">Không</option>{typeOptions.get(l!.productId)!.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select> : <span className="text-fg-muted">—</span>}</td>
                      <td className="px-2 py-2" data-label="ĐVT">
                        <select aria-label={`Đơn vị dòng ${index + 1}`} value={l?.unit ?? ""} className={`${inputClass(err?.unit)} min-w-20`}
                          onChange={(e) => { setValue(`lines.${index}.unit`, e.target.value, { shouldValidate: true, shouldDirty: true }); setValue(`lines.${index}.salePrice`, undefined as never); }}>
                          <option value="">—</option>{(product?.units ?? []).map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2" data-label="Số lượng"><input aria-label={`Số lượng dòng ${index + 1}`} type="number" min={0} step="any" {...register(`lines.${index}.qty`, { valueAsNumber: true })} onKeyDown={entry.onQtyKeyDown(index)} className={`${inputClass(err?.qty)} min-w-20 tabular text-right`} /></td>
                      <td className="px-2 py-2" data-label="Đơn giá"><input aria-label={`Đơn giá dòng ${index + 1}`} type="number" min={0} step="any" {...register(`lines.${index}.salePrice`, { valueAsNumber: true })} className={`${inputClass(err?.salePrice)} min-w-28 tabular text-right`} /></td>
                      <td className="px-2 py-2 text-right tabular" data-label="Thành tiền">{formatCurrency(Math.round(num(l?.qty) * num(l?.salePrice) * 100) / 100)}</td>
                      <td className="px-2 py-2" data-label="Ghi chú" data-wide><input aria-label={`Ghi chú dòng ${index + 1}`} {...register(`lines.${index}.note`)} className={inputClass(err?.note)} /></td>
                      <td className="px-2 py-2" data-action><button type="button" aria-label={`Xóa dòng ${index + 1}`} onClick={() => remove(index)} disabled={fields.length === 1} className="h-11 w-11 text-danger hover:bg-danger-soft disabled:opacity-40 md:h-9 md:w-9">×</button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr className="border-t-2 border-border bg-hover font-semibold"><td colSpan={5} className="px-2 py-3 text-right">Tổng báo giá</td><td className="px-2 py-3 text-right tabular">{formatCurrency(total)}</td><td colSpan={2} /></tr></tfoot>
            </table>
          </div>
          {errors.lines?.message && <p role="alert" className="text-sm text-danger">{errors.lines.message}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => append(emptyLine)} className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover md:h-10">+ Thêm dòng</button>
            <ProductMultiPicker load={loadProducts} existingIds={lines.flatMap((l) => (l?.productId ? [l.productId] : []))} onPicked={addProducts} />
          </div>
          <p className="text-xs text-fg-muted">Chọn sản phẩm → nhập SL → Enter để sang dòng tiếp theo; dòng trống cuối sẽ bị bỏ khi lập báo giá.</p>
        </div>
      </FormCard>
    </NewPage>
  );
}
