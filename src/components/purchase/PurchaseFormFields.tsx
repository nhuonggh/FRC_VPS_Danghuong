"use client";

import { LastSupplierPrice } from "./LastSupplierPrice";
import { Controller, useFieldArray, type UseFormReturn } from "react-hook-form";
import { useEffect, useState } from "react";
import { addPickedLines, Combobox, FormGrid, igArea, igCombo, igInput, InlineField, inputClass, ProductMultiPicker, useLineEntry, type ComboOption, RhfNumberInput, NumberInput } from "@/components/ui";
import { QuickCustomerDialog } from "@/components/sales/QuickCustomerDialog";
import { QuickProductDialog, type QuickProductConfig } from "@/components/products/QuickProductDialog";
import { apiFetch } from "@/lib/api-fetch";
import { useProcessingOptions, type ProcessingOptions } from "@/lib/use-processing-options";
import { formatCurrency, formatQty } from "@/lib/format";
import { sameUnit } from "@/lib/price-basis";
import { parseDimNote, parseLengthExpr, pricePerM2, pricePerMd, termNote, termQty } from "@/lib/length-expr";
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
export function PurchaseHeaderFields({ form, initialSupplier = null, maxDate, supplierGroups, ordering = false }: FormProps & { initialSupplier?: ComboOption | null; ordering?: boolean; maxDate: string; /** Có = hiện nút thêm nhanh nhà cung cấp (cần quyền quản lý đối tác). */ supplierGroups?: ComboOption[] }) {
  const { register, control, watch, setValue, formState: { errors } } = form;
  const [picked, setPicked] = useState<ComboOption | null>(initialSupplier);
  const supplier = watch("partnerId") ? picked : null;
  const loadSuppliers = (q: string) => apiFetch<ComboOption[]>(`/api/partner-lists/suppliers/search?q=${encodeURIComponent(q)}`);
  return <FormGrid>
    <InlineField id="supplier" label="Nhà cung cấp" required error={errors.partnerId?.message} className="md:col-span-2">
      <Controller control={control} name="partnerId" render={({ field }) => <>
        <div className={`${igCombo} min-w-40`}><Combobox hideLabel label="Nhà cung cấp" value={supplier} loadOptions={loadSuppliers} placeholder="Tìm nhà cung cấp…" onChange={(option) => { setPicked(option); field.onChange(option ? Number(option.value) : undefined); }} /></div>
        {supplierGroups && <div className="flex items-center border-l border-border px-1"><QuickCustomerDialog kind="supplier" groups={supplierGroups} onCreated={(c) => { setPicked(c); setValue("partnerId", Number(c.value), { shouldDirty: true, shouldValidate: true }); }} /></div>}
      </>} />
    </InlineField>
    <InlineField id="date" label={ordering ? "Ngày đặt" : "Ngày nhập"} required error={errors.date?.message}><input id="date" type="date" max={maxDate} {...register("date")} aria-invalid={!!errors.date} className={igInput} /></InlineField>
    {!ordering && <InlineField id="freightCost" label="Cước vận chuyển (₫)" hint="Phân bổ vào giá vốn theo giá trị dòng hàng" error={errors.freightCost?.message} labelClass="sm:min-w-44"><RhfNumberInput id="freightCost" control={control} name={"freightCost"} aria-invalid={!!errors.freightCost} className={`${igInput} tabular text-right`} /></InlineField>}
  </FormGrid>;
}

/** Ghi chú phiếu. */
export function PurchaseNoteField({ form }: FormProps) {
  const { register, formState: { errors } } = form;
  return <InlineField id="note" label="Ghi chú" multiline error={errors.note?.message}><textarea id="note" rows={3} {...register("note")} className={igArea} /></InlineField>;
}

/**
 * Nhập hàng theo kích thước (tôn mua từ nơi khác về bán): chọn sản phẩm, gõ `7.1*7+6.8*1` (dài*số tấm, nối bằng +) → mỗi số hạng một dòng,
 * SL = dài × số tấm (md, đơn vị gốc nên kho/FIFO không đổi), ghi chú cuộn ghi `7,1 m × 1,08 × 7 = 53,676 m²`. Giá nhập nhập theo md hoặc theo m² (liên động qua tỷ lệ m²/md, mặc định 1).
 */
function PurchaseDimensionEntry({ loadProducts, onAdd, typeOptions, ensureTypes, quickProduct }: { quickProduct?: QuickProductConfig; loadProducts: (q: string) => Promise<ProductOption[]>; onAdd: (product: ProductOption, rows: PurchaseInput["lines"]) => void; typeOptions: ProcessingOptions; ensureTypes: (productId: number | undefined) => void }) {
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [typeId, setTypeId] = useState("");
  const types = product ? (typeOptions.get(product.value) ?? []).filter((t) => t.priceBasis !== "UNIT") : []; // kiểu bán theo ĐVT riêng không dùng khối kích thước
  const area = types.find((t) => String(t.value) === typeId)?.priceBasis === "AREA"; // kiểu tính giá theo m²: chỉ nhập giá/m², giá/md tính ra
  const [len, setLen] = useState(""), [ratio, setRatio] = useState("1"), [perMd, setPerMd] = useState(""), [m2Str, setM2Str] = useState<string | null>(null), [error, setError] = useState(""), [key, setKey] = useState(0);
  const r = Number(ratio.replace(",", ".")) || 0;
  // Giá/m² là ô gốc khi khách gõ ở đó: giữ đúng số đã gõ; đổi tỷ lệ/kiểu gia công thì chỉ giá/md tính lại
  useEffect(() => { if (m2Str !== null && m2Str !== "" && r > 0) setPerMd(String(pricePerMd(Number(m2Str), r))); }, [r]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => {
    if (!product) { setError("Chọn sản phẩm trước."); return; }
    const parsed = parseLengthExpr(len);
    if ("error" in parsed) { setError(parsed.error); return; }
    if (!(r > 0)) { setError("Tỷ lệ m²/md phải lớn hơn 0."); return; }
    const price = Number(perMd);
    if (perMd.trim() === "" || !(price >= 0)) { setError("Nhập giá nhập."); return; }
    onAdd(product, parsed.terms.map((t) => ({ productId: product.value, unit: product.baseUnit, factor: 1, qty: termQty(t), purchasePrice: price, rollInfo: termNote(t, r), processingTypeId: typeId ? Number(typeId) : null })) as PurchaseInput["lines"]);
    setProduct(null); setTypeId(""); setLen(""); setPerMd(""); setM2Str(null); setError(""); setKey((k) => k + 1);
  };
  const enter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
  const small = `${igInput} tabular text-right`;
  return <div className="rounded-sm border border-dashed border-border p-3">
    <h3 className="text-sm font-semibold">Nhập theo kích thước</h3>
    <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <InlineField id="pd-product" label="Sản phẩm" className="xl:col-span-2"><div className={igCombo}><Combobox hideLabel key={key} label="Sản phẩm (nhập theo kích thước)" value={product} loadOptions={loadProducts} placeholder="Tìm mã, tên…" onChange={(o) => { setProduct(o as ProductOption | null); setTypeId(""); setError(""); ensureTypes(o ? Number(o.value) : undefined); }} /></div>{quickProduct && <div className="flex items-center border-l border-border px-1"><QuickProductDialog config={quickProduct} onCreated={(p) => { setProduct(p); setTypeId(""); setError(""); setKey((k) => k + 1); ensureTypes(p.value); }} /></div>}</InlineField>
      {types.length > 0 && <InlineField id="pd-type" label="Kiểu gia công" hint="tuỳ chọn — tự điền tỷ lệ m²/md"><select id="pd-type" value={typeId} onChange={(e) => { setTypeId(e.target.value); const picked = types.find((t) => String(t.value) === e.target.value); if (picked) setRatio(String(picked.ratio ?? 1).replace(".", ",")); }} className={`${igInput} cursor-pointer`}><option value="">Không</option>{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></InlineField>}
      <InlineField id="pd-len" label="Chiều dài" hint="dài*số tấm, nối bằng +"><input id="pd-len" value={len} onChange={(e) => { setLen(e.target.value); setError(""); }} onKeyDown={enter} placeholder="7.1*7+6.8*1" autoComplete="off" className={igInput} /></InlineField>
      <InlineField id="pd-ratio" label="Tỷ lệ m²/md"><input id="pd-ratio" inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} onKeyDown={enter} className={small} /></InlineField>
      {!area && <InlineField id="pd-price" label="Giá nhập/md"><NumberInput maxFrac={2} id="pd-price" value={perMd} onValueChange={(val) => { setPerMd(val); setM2Str(null); }} onKeyDown={enter} className={small} /></InlineField>}
      {area && <InlineField id="pd-m2" label="Giá nhập/m²"><NumberInput maxFrac={2} id="pd-m2" value={m2Str ?? (perMd !== "" && r > 0 ? pricePerM2(Number(perMd), r) : "")} onValueChange={(val) => { const v = val; setM2Str(v); setPerMd(v === "" || r <= 0 ? "" : String(pricePerMd(Number(v), r))); }} onKeyDown={enter} className={small} /></InlineField>}
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    <div className="mt-3 flex justify-end"><button type="button" onClick={submit} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10">Thêm vào phiếu</button></div>
  </div>;
}

/** Bảng dòng hàng + nút thêm dòng / chọn nhiều + tiền hàng. Trên mobile mỗi dòng là một thẻ. */
export function PurchaseLinesFields({ form, initialProducts = [], quickProduct, ordering = false, onlyLineId }: FormProps & { initialProducts?: ProductOption[]; ordering?: boolean; /** Có = chỉ hiện (và cho sửa) đúng dòng này của phiếu đã lập; các dòng khác giữ nguyên giá trị, ẩn khỏi bảng. */ onlyLineId?: number; /** Có = hiện nút thêm nhanh sản phẩm (cần quyền quản lý sản phẩm). */ quickProduct?: QuickProductConfig }) {
  const { register, control, watch, setValue, getValues, formState: { errors } } = form;
  const { fields, append, remove, update } = useFieldArray({ control, name: "lines" });
  const lines = watch("lines");
  const { options: typeOptions, ensure: ensureTypes } = useProcessingOptions();
  const productKey = lines.map((l) => l?.productId ?? 0).join(",");
  useEffect(() => { for (const id of new Set(productKey.split(",").map(Number))) ensureTypes(id || undefined); }, [productKey, ensureTypes]);
  const [products, setProducts] = useState(() => new Map(initialProducts.map((product) => [product.value, product])));
  const loadProducts = async (q: string) => {
    const result = await apiFetch<ProductOption[]>(`/api/products/search?capability=canPurchase&q=${encodeURIComponent(q)}`);
    setProducts((current) => new Map([...current, ...result.map((row) => [row.value, row] as const)]));
    return result;
  };
  const goodsTotal = lines.reduce((sum, line) => sum + asNumber(line?.qty) * asNumber(line?.purchasePrice), 0);
  // Tỷ trọng / SL gốc chỉ hiện khi có dòng quy đổi đơn vị (tỷ trọng khác 1) — còn lại hai cột trùng số lượng, chỉ gây rối
  const showFactor = lines.some((l) => { const f = asNumber(l?.factor); return f > 0 && f !== 1; });
  // Dòng tính giá theo m²: số lượng là md nên ghi thêm diện tích để khớp Đơn giá (đ/m²) × m² = Thành tiền
  const areaCaption = (line: PurchaseInput["lines"][number]) => {
    const opt = (typeOptions.get(line.productId) ?? []).find((t) => Number(t.value) === line.processingTypeId);
    const ratio = parseDimNote(line.rollInfo)?.ratio ?? opt?.ratio ?? 1;
    if (opt?.priceBasis !== "AREA" || !(ratio > 0) || !(asNumber(line.qty) > 0) || line.unit !== products.get(line.productId)?.baseUnit) return null;
    return <p className="mt-0.5 text-right text-xs text-fg-muted tabular">= {formatQty(round3(asNumber(line.qty) * ratio))} m²</p>;
  };
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
    {onlyLineId === undefined && <PurchaseDimensionEntry quickProduct={quickProduct} loadProducts={loadProducts} onAdd={addDimensionRows} typeOptions={typeOptions} ensureTypes={ensureTypes} />}
    <div className="overflow-x-auto rounded-sm border border-border">
      <table className="line-table w-full min-w-[1000px] text-sm">
        <thead><tr className="border-b border-border bg-hover text-left text-xs font-semibold text-fg-secondary">
          {ordering && <th className="px-2 py-2 text-center">STT</th>}
          <th className="px-2 py-2">Sản phẩm</th><th className="px-2 py-2">Kiểu gia công</th><th className="px-2 py-2">Đơn vị</th><th className="px-2 py-2 text-right">Số lượng</th>{showFactor && <><th className="px-2 py-2 text-right">Tỷ trọng</th><th className="px-2 py-2 text-right">SL gốc</th></>}
          <th className="px-2 py-2 text-right">Đơn giá</th><th className="px-2 py-2 text-right">Thành tiền</th>{ordering && <th className="px-2 py-2">Dự kiến giao / Giá gần nhất</th>}<th className="px-2 py-2">Ghi chú / Kích thước</th><th aria-label="Thao tác" />
        </tr></thead>
        <tbody>{fields.map((field, index) => {
          const line = lines[index] ?? emptyPurchaseLine; if (onlyLineId !== undefined && line.id !== onlyLineId) return null; const error = errors.lines?.[index]; const product = products.get(line.productId); const units = product?.units ?? [];
          const qtyBase = asNumber(line.qty) && asNumber(line.factor) ? round3(asNumber(line.qty) / asNumber(line.factor)) : 0;
          const dup = line.productId ? lines.findIndex((o, i) => i < index && o?.productId === line.productId && o?.unit === line.unit) + 1 : 0;
          return <tr key={field.id} className="border-b border-border align-top last:border-b-0">
            {ordering && <td data-stt className="px-2 py-2 text-center tabular text-fg-secondary">{index + 1}</td>}
            <td className="min-w-64 px-2 py-2" data-line-product={index} data-label="Sản phẩm" data-wide>
              <Controller control={control} name={`lines.${index}.productId`} render={({ field: item }) => <Combobox hideLabel={ordering} label={`Sản phẩm dòng ${index + 1}`} value={product ?? null} loadOptions={loadProducts} placeholder="Tìm mã, tên…" error={error?.productId?.message}
                onChange={(option) => {
                  item.onChange(option ? Number(option.value) : undefined);
                  const selected = option as ProductOption | null;
                  if (selected) setProducts((current) => new Map(current).set(selected.value, selected));
                  setValue(`lines.${index}.unit`, selected?.baseUnit ?? "", { shouldValidate: true });
                  setValue(`lines.${index}.factor`, 1, { shouldValidate: true });
                  setValue(`lines.${index}.processingTypeId`, null, { shouldDirty: true });
                  ensureTypes(selected ? Number(selected.value) : undefined);
                  if (selected) entry.onProductPicked(index);
                }} />} />
              {dup > 0 && <p role="status" className="mt-1 text-xs font-medium text-warning">Sản phẩm này đã có ở dòng {dup}</p>}
            </td>
            <td className="px-2 py-2" data-label="Kiểu gia công">{(typeOptions.get(line.productId) ?? []).length > 0 ? <select aria-label={`Kiểu gia công dòng ${index + 1}`} value={line.processingTypeId ?? ""} onChange={(event) => {
              setValue(`lines.${index}.processingTypeId`, event.target.value ? Number(event.target.value) : null, { shouldDirty: true });
              // Kiểu bán theo ĐVT riêng (kg, bình, cây…): đơn vị dòng tự chọn đúng ĐVT đó, tỷ trọng theo đơn vị quy đổi của sản phẩm
              const t = (typeOptions.get(line.productId) ?? []).find((x) => Number(x.value) === Number(event.target.value));
              const u = t?.priceBasis === "UNIT" ? units.find((x) => sameUnit(x.unit, t.unit)) : undefined;
              if (u) { setValue(`lines.${index}.unit`, u.unit, { shouldValidate: true, shouldDirty: true }); setValue(`lines.${index}.factor`, Number(u.factor), { shouldValidate: true, shouldDirty: true }); }
            }} className={inputClass()}><option value="">Không</option>{typeOptions.get(line.productId)!.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select> : <span className="text-fg-muted">—</span>}</td>
            <td className="px-2 py-2" data-label="Đơn vị"><select aria-label={`Đơn vị dòng ${index + 1}`} {...register(`lines.${index}.unit`)} onChange={(event) => { const unit = event.target.value; const factor = units.find((item) => item.unit === unit)?.factor ?? "1"; setValue(`lines.${index}.unit`, unit, { shouldValidate: true }); setValue(`lines.${index}.factor`, Number(factor), { shouldValidate: true }); }} className={inputClass(error?.unit)}><option value="">—</option>{units.map((unit) => <option key={unit.unit} value={unit.unit}>{unit.unit}</option>)}</select></td>
            <td className="px-2 py-2" data-label="Số lượng"><RhfNumberInput aria-label={`Số lượng dòng ${index + 1}`} maxFrac={3} control={control} name={`lines.${index}.qty`} onKeyDown={entry.onQtyKeyDown(index)} className={`${inputClass(error?.qty)} tabular text-right`} />{areaCaption(line)}</td>
            {showFactor && <td className="px-2 py-2" data-label="Tỷ trọng"><RhfNumberInput aria-label={`Tỷ trọng dòng ${index + 1}`} maxFrac={3} control={control} name={`lines.${index}.factor`} className={`${inputClass(error?.factor)} tabular text-right`} /></td>}
            {showFactor && <td className="px-2 py-2 text-right tabular" data-label="SL gốc">{qtyBase ? formatQty(qtyBase) : "—"}</td>}
            <td className="px-2 py-2" data-label="Đơn giá">{(() => {
              // Kiểu gia công tính giá theo m²: nhập/hiện giá/m² (giá lưu vẫn là giá/md = giá/m² × tỷ lệ)
              const opt = (typeOptions.get(line.productId) ?? []).find((t) => Number(t.value) === line.processingTypeId);
              const ratio = parseDimNote(line.rollInfo)?.ratio ?? opt?.ratio ?? 1; // dòng tách theo chiều dài ghi sẵn tỷ lệ trong ghi chú cuộn
              if (opt?.priceBasis === "AREA" && ratio > 0 && line.unit === product?.baseUnit) return <><NumberInput maxFrac={2} aria-label={`Đơn giá dòng ${index + 1}`} value={asNumber(line.purchasePrice) ? pricePerM2(asNumber(line.purchasePrice), ratio) : ""} onValueChange={(val) => setValue(`lines.${index}.purchasePrice`, val === "" ? (undefined as never) : pricePerMd(Number(val), ratio), { shouldValidate: true, shouldDirty: true })} className={`${inputClass(error?.purchasePrice)} tabular text-right`} /><p className="mt-0.5 text-right text-xs text-fg-muted">đ/m²</p></>;
              return <RhfNumberInput aria-label={`Đơn giá dòng ${index + 1}`} maxFrac={2} control={control} name={`lines.${index}.purchasePrice`} className={`${inputClass(error?.purchasePrice)} tabular text-right`} />;
            })()}</td>
            <td className="px-2 py-2 text-right tabular" data-label="Thành tiền">{formatCurrency(asNumber(line.qty) * asNumber(line.purchasePrice))}</td>
            {ordering && <td className="px-2 py-2" data-label="Dự kiến giao / Giá gần nhất" data-wide><input type="date" aria-label={`Dự kiến giao dòng ${index + 1}`} {...register(`lines.${index}.expectedDate`)} className={inputClass()} /><LastSupplierPrice partnerId={watch("partnerId")} productId={line.productId} /></td>}
            <td className="px-2 py-2" data-label="Ghi chú cuộn" data-wide><input aria-label={`Ghi chú cuộn dòng ${index + 1}`} {...register(`lines.${index}.rollInfo`)} className={inputClass(error?.rollInfo)} /></td>
            <td className="px-2 py-2" data-action>{onlyLineId === undefined && <button type="button" aria-label={`Xóa dòng ${index + 1}`} onClick={() => remove(index)} className="h-11 w-11 text-danger hover:bg-danger-soft md:h-9 md:w-9">×</button>}</td>
          </tr>;
        })}</tbody>
        <tfoot><tr className="border-t-2 border-border bg-hover font-semibold"><td colSpan={(showFactor ? 7 : 5) + (ordering ? 1 : 0)} className="px-2 py-3 text-right">Tiền hàng</td><td className="px-2 py-3 text-right tabular">{formatCurrency(goodsTotal)}</td><td colSpan={ordering ? 3 : 2} /></tr></tfoot>
      </table>
    </div>
    {onlyLineId === undefined && <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => append(emptyPurchaseLine)} className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover md:h-10">+ Thêm dòng</button>
      <ProductMultiPicker load={loadProducts} existingIds={lines.flatMap((l) => (l?.productId ? [l.productId] : []))} onPicked={addProducts} />
    </div>}
  </div>;
}

export function PurchaseFormFields({ form, initialSupplier = null, initialProducts = [], maxDate }: { form: UseFormReturn<PurchaseInput>; initialSupplier?: ComboOption | null; initialProducts?: ProductOption[]; maxDate: string }) {
  return <div className="space-y-5">
    <PurchaseHeaderFields form={form} initialSupplier={initialSupplier} maxDate={maxDate} />
    <PurchaseLinesFields form={form} initialProducts={initialProducts} />
    <PurchaseNoteField form={form} />
  </div>;
}
