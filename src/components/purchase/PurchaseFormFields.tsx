"use client";

import { Controller, useFieldArray, type UseFormReturn } from "react-hook-form";
import { useState } from "react";
import { addPickedLines, Combobox, Field, inputClass, ProductMultiPicker, useLineEntry, type ComboOption } from "@/components/ui";
import { QuickCustomerDialog } from "@/components/sales/QuickCustomerDialog";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatQty } from "@/lib/format";
import { parseLengthExpr, pricePerM2, pricePerMd, termNote, termQty } from "@/lib/length-expr";
import type { PurchaseInput } from "@/server/purchase/schemas";
import type { ProductOption } from "@/server/products/queries";

export const emptyPurchaseLine = { productId: undefined, qty: undefined, unit: "", factor: 1, purchasePrice: undefined, rollInfo: "" } as unknown as PurchaseInput["lines"][number];
const asNumber = (value: unknown) => Number(value) || 0;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

type FormProps = { form: UseFormReturn<PurchaseInput> };

/** Bỏ dòng trống (chưa chọn SP, chưa nhập SL) trước khi lưu — trừ khi mọi dòng đều trống (để hiện lỗi). */
export function dropEmptyPurchaseLines(form: UseFormReturn<PurchaseInput>) {
  const lines = form.getValues("lines");
  const kept = lines.filter((l) => l?.productId || asNumber(l?.qty));
  if (kept.length > 0 && kept.length < lines.length) form.setValue("lines", kept, { shouldDirty: true });
}

/** Nhà cung cấp · ngày nhập · cước vận chuyển. */
export function PurchaseHeaderFields({ form, initialSupplier = null, maxDate, supplierGroups }: FormProps & { initialSupplier?: ComboOption | null; maxDate: string; /** Có = hiện nút thêm nhanh nhà cung cấp (cần quyền quản lý đối tác). */ supplierGroups?: ComboOption[] }) {
  const { register, control, watch, setValue, formState: { errors } } = form;
  const [picked, setPicked] = useState<ComboOption | null>(initialSupplier);
  const supplier = watch("partnerId") ? picked : null;
  const loadSuppliers = (q: string) => apiFetch<ComboOption[]>(`/api/partner-lists/suppliers/search?q=${encodeURIComponent(q)}`);
  return <>
    <div className="grid gap-4 sm:grid-cols-3"><Controller control={control} name="partnerId" render={({ field }) => <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><Combobox label="Nhà cung cấp" value={supplier} loadOptions={loadSuppliers} placeholder="Tìm nhà cung cấp…" onChange={(option) => { setPicked(option); field.onChange(option ? Number(option.value) : undefined); }} error={errors.partnerId?.message} /></div>{supplierGroups && <QuickCustomerDialog kind="supplier" groups={supplierGroups} onCreated={(c) => { setPicked(c); setValue("partnerId", Number(c.value), { shouldDirty: true, shouldValidate: true }); }} />}</div>} />
      <Field id="date" label="Ngày nhập" required error={errors.date?.message}><input id="date" type="date" max={maxDate} {...register("date")} className={inputClass(errors.date)} /></Field>
      <Field id="freightCost" label="Cước vận chuyển (₫)" hint="Phân bổ vào giá vốn theo giá trị dòng hàng" error={errors.freightCost?.message}><input id="freightCost" type="number" min={0} step="any" {...register("freightCost", { valueAsNumber: true })} className={`${inputClass(errors.freightCost)} tabular text-right`} /></Field></div>
  </>;
}

/** Ghi chú phiếu. */
export function PurchaseNoteField({ form }: FormProps) {
  const { register, formState: { errors } } = form;
  return <>
    <Field id="note" label="Ghi chú" error={errors.note?.message}><textarea id="note" rows={3} {...register("note")} className="w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" /></Field>
  </>;
}

/**
 * Nhập hàng theo kích thước (tôn mua từ nơi khác về bán): chọn sản phẩm, gõ `7.1*7+6.8*1` (dài*số tấm, nối bằng +) → mỗi số hạng một dòng,
 * SL = dài × số tấm (md, đơn vị gốc nên kho/FIFO không đổi), ghi chú cuộn ghi `7,1 m × 1,08 × 7 = 53,676 m²`. Giá nhập nhập theo md hoặc theo m² (liên động qua tỷ lệ m²/md, mặc định 1).
 */
function PurchaseDimensionEntry({ loadProducts, onAdd }: { loadProducts: (q: string) => Promise<ProductOption[]>; onAdd: (product: ProductOption, rows: PurchaseInput["lines"]) => void }) {
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [len, setLen] = useState(""), [ratio, setRatio] = useState("1"), [perMd, setPerMd] = useState(""), [error, setError] = useState(""), [key, setKey] = useState(0);
  const r = Number(ratio.replace(",", ".")) || 0;
  const submit = () => {
    if (!product) { setError("Chọn sản phẩm trước."); return; }
    const parsed = parseLengthExpr(len);
    if ("error" in parsed) { setError(parsed.error); return; }
    if (!(r > 0)) { setError("Tỷ lệ m²/md phải lớn hơn 0."); return; }
    const price = Number(perMd);
    if (perMd.trim() === "" || !(price >= 0)) { setError("Nhập giá nhập."); return; }
    onAdd(product, parsed.terms.map((t) => ({ productId: product.value, unit: product.baseUnit, factor: 1, qty: termQty(t), purchasePrice: price, rollInfo: termNote(t, r) })) as PurchaseInput["lines"]);
    setProduct(null); setLen(""); setPerMd(""); setError(""); setKey((k) => k + 1);
  };
  const enter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
  const small = `${inputClass()} tabular text-right`;
  return <div className="rounded-sm border border-dashed border-border p-3">
    <h3 className="text-sm font-semibold">Nhập theo kích thước</h3>
    <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <div className="xl:col-span-2"><Combobox key={key} label="Sản phẩm (nhập theo kích thước)" value={product} loadOptions={loadProducts} placeholder="Tìm mã, tên…" onChange={(o) => { setProduct(o as ProductOption | null); setError(""); }} /></div>
      <Field id="pd-len" label="Chiều dài" hint="dài*số tấm, nối bằng +"><input id="pd-len" value={len} onChange={(e) => { setLen(e.target.value); setError(""); }} onKeyDown={enter} placeholder="7.1*7+6.8*1" autoComplete="off" className={inputClass()} /></Field>
      <Field id="pd-ratio" label="Tỷ lệ m²/md"><input id="pd-ratio" inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} onKeyDown={enter} className={small} /></Field>
      <Field id="pd-price" label="Giá nhập/md"><input id="pd-price" type="number" min={0} step="any" value={perMd} onChange={(e) => setPerMd(e.target.value)} onKeyDown={enter} className={small} /></Field>
      <Field id="pd-m2" label="Giá nhập/m²" hint="liên động với giá/md"><input id="pd-m2" type="number" min={0} step="any" value={perMd !== "" && r > 0 ? pricePerM2(Number(perMd), r) : ""} onChange={(e) => setPerMd(e.target.value === "" || r <= 0 ? "" : String(pricePerMd(Number(e.target.value), r)))} onKeyDown={enter} className={small} /></Field>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    <div className="mt-3 flex justify-end"><button type="button" onClick={submit} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10">Thêm vào phiếu</button></div>
  </div>;
}

/** Bảng dòng hàng + nút thêm dòng / chọn nhiều + tiền hàng. Trên mobile mỗi dòng là một thẻ. */
export function PurchaseLinesFields({ form, initialProducts = [] }: FormProps & { initialProducts?: ProductOption[] }) {
  const { register, control, watch, setValue, getValues, formState: { errors } } = form;
  const { fields, append, remove, update } = useFieldArray({ control, name: "lines" });
  const lines = watch("lines");
  const [products, setProducts] = useState(() => new Map(initialProducts.map((product) => [product.value, product])));
  const loadProducts = async (q: string) => {
    const result = await apiFetch<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(q)}`);
    setProducts((current) => new Map([...current, ...result.map((row) => [row.value, row] as const)]));
    return result;
  };
  const goodsTotal = lines.reduce((sum, line) => sum + asNumber(line?.qty) * asNumber(line?.purchasePrice), 0);
  const entry = useLineEntry({ count: fields.length, getLines: () => getValues("lines"), append, remove, blank: emptyPurchaseLine, qtyLabel: (i) => `Số lượng dòng ${i + 1}` });
  const addProducts = (picked: ProductOption[]) => {
    setProducts((current) => new Map([...current, ...picked.map((row) => [row.value, row] as const)]));
    addPickedLines(picked, getValues("lines"), (p) => ({ ...emptyPurchaseLine, productId: p.value, unit: p.baseUnit, factor: 1 }), { update, append: (vs) => append(vs) });
  };
  /** Dòng từ khối nhập theo kích thước: lấp dòng trống trước, còn lại thêm cuối. */
  const addDimensionRows = (product: ProductOption, rows: PurchaseInput["lines"]) => {
    setProducts((current) => new Map(current).set(product.value, product));
    const current = getValues("lines");
    const blanks = current.flatMap((l, i) => (l?.productId || asNumber(l?.qty) ? [] : [i]));
    rows.slice(0, blanks.length).forEach((row, k) => update(blanks[k]!, row));
    const rest = rows.slice(blanks.length);
    if (rest.length) append(rest);
  };
  return <div className="space-y-5">
    <PurchaseDimensionEntry loadProducts={loadProducts} onAdd={addDimensionRows} />
    <div className="overflow-x-auto rounded-sm border border-border">
      <table className="line-table w-full min-w-[900px] text-sm">
        <thead><tr className="border-b border-border bg-hover text-left text-xs font-semibold text-fg-secondary">
          <th className="px-2 py-2">Sản phẩm</th><th className="px-2 py-2">Đơn vị</th><th className="px-2 py-2 text-right">Số lượng</th><th className="px-2 py-2 text-right">Tỷ trọng</th><th className="px-2 py-2 text-right">SL gốc</th>
          <th className="px-2 py-2 text-right">Đơn giá</th><th className="px-2 py-2 text-right">Thành tiền</th><th className="px-2 py-2">Ghi chú cuộn</th><th aria-label="Thao tác" />
        </tr></thead>
        <tbody>{fields.map((field, index) => {
          const line = lines[index] ?? emptyPurchaseLine; const error = errors.lines?.[index]; const product = products.get(line.productId); const units = product?.units ?? [];
          const qtyBase = asNumber(line.qty) && asNumber(line.factor) ? round3(asNumber(line.qty) / asNumber(line.factor)) : 0;
          const dup = line.productId ? lines.findIndex((o, i) => i < index && o?.productId === line.productId && o?.unit === line.unit) + 1 : 0;
          return <tr key={field.id} className="border-b border-border align-top last:border-b-0">
            <td className="min-w-64 px-2 py-2" data-line-product={index} data-label="Sản phẩm" data-wide>
              <Controller control={control} name={`lines.${index}.productId`} render={({ field: item }) => <Combobox label={`Sản phẩm dòng ${index + 1}`} value={product ?? null} loadOptions={loadProducts} placeholder="Tìm mã, tên…" error={error?.productId?.message}
                onChange={(option) => {
                  item.onChange(option ? Number(option.value) : undefined);
                  const selected = option as ProductOption | null;
                  if (selected) setProducts((current) => new Map(current).set(selected.value, selected));
                  setValue(`lines.${index}.unit`, selected?.baseUnit ?? "", { shouldValidate: true });
                  setValue(`lines.${index}.factor`, 1, { shouldValidate: true });
                  if (selected) entry.onProductPicked(index);
                }} />} />
              {dup > 0 && <p role="status" className="mt-1 text-xs font-medium text-warning">Sản phẩm này đã có ở dòng {dup}</p>}
            </td>
            <td className="px-2 py-2" data-label="Đơn vị"><select aria-label={`Đơn vị dòng ${index + 1}`} {...register(`lines.${index}.unit`)} onChange={(event) => { const unit = event.target.value; const factor = units.find((item) => item.unit === unit)?.factor ?? "1"; setValue(`lines.${index}.unit`, unit, { shouldValidate: true }); setValue(`lines.${index}.factor`, Number(factor), { shouldValidate: true }); }} className={inputClass(error?.unit)}><option value="">—</option>{units.map((unit) => <option key={unit.unit} value={unit.unit}>{unit.unit}</option>)}</select></td>
            <td className="px-2 py-2" data-label="Số lượng"><input aria-label={`Số lượng dòng ${index + 1}`} type="number" min={0} step="any" {...register(`lines.${index}.qty`, { valueAsNumber: true })} onKeyDown={entry.onQtyKeyDown(index)} className={`${inputClass(error?.qty)} tabular text-right`} /></td>
            <td className="px-2 py-2" data-label="Tỷ trọng"><input aria-label={`Tỷ trọng dòng ${index + 1}`} type="number" min={0} step="any" {...register(`lines.${index}.factor`, { valueAsNumber: true })} className={`${inputClass(error?.factor)} tabular text-right`} /></td>
            <td className="px-2 py-2 text-right tabular" data-label="SL gốc">{qtyBase ? formatQty(qtyBase) : "—"}</td>
            <td className="px-2 py-2" data-label="Đơn giá"><input aria-label={`Đơn giá dòng ${index + 1}`} type="number" min={0} step="any" {...register(`lines.${index}.purchasePrice`, { valueAsNumber: true })} className={`${inputClass(error?.purchasePrice)} tabular text-right`} /></td>
            <td className="px-2 py-2 text-right tabular" data-label="Thành tiền">{formatCurrency(asNumber(line.qty) * asNumber(line.purchasePrice))}</td>
            <td className="px-2 py-2" data-label="Ghi chú cuộn" data-wide><input aria-label={`Ghi chú cuộn dòng ${index + 1}`} {...register(`lines.${index}.rollInfo`)} className={inputClass(error?.rollInfo)} /></td>
            <td className="px-2 py-2" data-action><button type="button" aria-label={`Xóa dòng ${index + 1}`} onClick={() => remove(index)} className="h-11 w-11 text-danger hover:bg-danger-soft md:h-9 md:w-9">×</button></td>
          </tr>;
        })}</tbody>
        <tfoot><tr className="border-t-2 border-border bg-hover font-semibold"><td colSpan={6} className="px-2 py-3 text-right">Tiền hàng</td><td className="px-2 py-3 text-right tabular">{formatCurrency(goodsTotal)}</td><td colSpan={2} /></tr></tfoot>
      </table>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => append(emptyPurchaseLine)} className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover md:h-10">+ Thêm dòng</button>
      <ProductMultiPicker load={loadProducts} existingIds={lines.flatMap((l) => (l?.productId ? [l.productId] : []))} onPicked={addProducts} />
    </div>
  </div>;
}

export function PurchaseFormFields({ form, initialSupplier = null, initialProducts = [], maxDate }: { form: UseFormReturn<PurchaseInput>; initialSupplier?: ComboOption | null; initialProducts?: ProductOption[]; maxDate: string }) {
  return <div className="space-y-5">
    <PurchaseHeaderFields form={form} initialSupplier={initialSupplier} maxDate={maxDate} />
    <PurchaseLinesFields form={form} initialProducts={initialProducts} />
    <PurchaseNoteField form={form} />
  </div>;
}
