"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { Factory, Package, Trash2 } from "lucide-react";
import { addPickedLines, Combobox, FormCard, FormGrid, igInput, InlineField, NewPage, ProductMultiPicker, inputClass, useLineEntry, RhfNumberInput } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { formatQty } from "@/lib/format";
import { productionOrderSchema, type ProductionOrderInput, type ProductionOutputInput } from "@/server/production/schemas";
import type { ProductOption } from "@/server/products/queries";
import { QuickProductDialog, type QuickProductConfig } from "@/components/products/QuickProductDialog";

const blank = { productId: undefined, qty: undefined } as unknown as ProductionOrderInput["materials"][number];
const blankOutput = { ...blank, stripCount: 1 } as ProductionOutputInput;
export function ProductionOrderForm({ today, quickProduct }: { today: string; quickProduct?: QuickProductConfig }) {
  const router = useRouter(), idem = useIdempotencyKey();
  const [meta, setMeta] = useState<Record<number, ProductOption>>({});
  const form = useForm<ProductionOrderInput>({ resolver: zodResolver(productionOrderSchema), defaultValues: { date: today, note: "", allocationBasis: "WEIGHT", outputs: [{ ...blankOutput, allocationWeight: 1 }], materials: [blank] } });
  const materials = useFieldArray({ control: form.control, name: "materials" });
  const outputRows = useFieldArray({ control: form.control, name: "outputs" });
  const entry = useLineEntry({ count: materials.fields.length, getLines: () => form.getValues("materials"), append: materials.append, remove: materials.remove, blank, qtyLabel: i => `Số lượng NVL dòng ${i + 1}` });
  const addProducts = (picked: ProductOption[]) => addPickedLines(picked, form.getValues("materials"), p => ({ ...blank, productId: p.value }), { update: materials.update, append: vs => materials.append(vs) });
  const load = (capability: string) => async (q: string) => {
    const rows = await apiFetch<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(q)}&capability=${capability}`);
    setMeta(x => ({ ...x, ...Object.fromEntries(rows.map(p => [p.value, p])) }));
    return rows;
  };
  const submit = form.handleSubmit(async value => {
    const result = await apiFetch<{ id: number }>("/api/production/orders", { method: "POST", json: value, idempotencyKey: idem.key });
    router.replace(`/production/orders/${result.id}`);
  });
  const err = form.formState.errors, outputs = form.watch("outputs") ?? [], inputs = form.watch("materials");
  const area = form.watch("allocationBasis") === "AREA";
  const weights = outputs.map(o => area ? (o.lengthM || 0) * (o.stripCount || 1) * (o.widthMm || 0) / 1000 : (o.allocationWeight || 0));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const remainingWidth = (inputs[0]?.widthMm || 0) - outputs.reduce((sum, o) => sum + (o.widthMm || 0) * (o.stripCount || 1), 0);
  const syncOutputQty = (i: number) => { const o = form.getValues(`outputs.${i}`); form.setValue(`outputs.${i}.qty`, Math.round((o?.lengthM || 0) * (o?.stripCount || 1) * 1000) / 1000, { shouldDirty: true }); };
  return <NewPage wide backHref="/production/orders" backLabel="Quay lại lệnh sản xuất" title="Lập lệnh sản xuất" submitLabel="Lưu lệnh" isDirty={() => form.formState.isDirty} onSubmit={async () => { entry.dropEmptyLines(); if (area) outputs.forEach((_, i) => syncOutputQty(i)); await submit(); }}>
    <FormCard icon={Factory} title="Thông tin lệnh sản xuất">
      <p className="mb-3 text-sm text-fg-secondary">Xuất nguyên vật liệu theo FIFO và nhập tất cả sản phẩm đầu ra trong cùng lệnh. Giá vốn phân bổ theo diện tích xẻ khổ hoặc trọng số đã nhập.</p>
      <FormGrid cols={2}>
        <InlineField id="date" label="Ngày sản xuất" required error={err.date?.message}><input id="date" type="date" max={today} {...form.register("date")} aria-invalid={!!err.date} className={igInput} /></InlineField>
        <InlineField id="note" label="Ghi chú"><input id="note" {...form.register("note")} className={igInput} /></InlineField>
        <InlineField id="allocationBasis" label="Phân bổ giá vốn"><select id="allocationBasis" {...form.register("allocationBasis")} className={igInput}><option value="WEIGHT">Theo trọng số</option><option value="AREA">Xẻ khổ — theo diện tích</option></select></InlineField>
      </FormGrid>
    </FormCard>
    <FormCard icon={Package} title="Nguyên vật liệu đã dùng">
      <div className="overflow-x-auto rounded-sm border border-border"><table className="line-table w-full text-sm">
        <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="p-2">Nguyên vật liệu</th><th className="p-2 text-right">Số lượng (đv gốc)</th>{area && <th className="p-2 text-right">Khổ (mm)</th>}<th /></tr></thead>
        <tbody>{materials.fields.map((row, i) => {
          const e = err.materials?.[i], product = meta[inputs[i]?.productId];
          return <tr key={row.id} className="border-t border-border">
            <td className="p-2" data-line-product={i} data-label="Nguyên vật liệu" data-wide><Controller control={form.control} name={`materials.${i}.productId`} render={({ field }) => <Combobox label={`Nguyên vật liệu dòng ${i + 1}`} value={product ?? null} loadOptions={load("canUseAsMaterial")} onChange={o => { field.onChange(o ? Number(o.value) : undefined); if (o) entry.onProductPicked(i); }} error={e?.productId?.message} />} /></td>
            <td className="p-2" data-label="Số lượng (đv gốc)"><RhfNumberInput aria-label={`Số lượng NVL dòng ${i + 1}`} maxFrac={3} control={form.control} name={`materials.${i}.qty`} onKeyDown={entry.onQtyKeyDown(i)} className={`${inputClass(e?.qty)} tabular text-right`} /><span className="block text-right text-xs text-fg-secondary">{product?.baseUnit}</span>{e?.qty && <p role="alert" className="text-sm text-danger">{e.qty.message}</p>}</td>
            {area && <td className="p-2" data-label="Khổ (mm)"><RhfNumberInput aria-label={`Khổ nguyên liệu dòng ${i + 1}`} maxFrac={3} control={form.control} name={`materials.${i}.widthMm`} className={`${inputClass(e?.widthMm)} tabular text-right`} />{e?.widthMm && <p role="alert" className="text-sm text-danger">{e.widthMm.message}</p>}</td>}
            <td data-action><button type="button" aria-label={`Xóa nguyên liệu dòng ${i + 1}`} title="Xóa nguyên liệu" disabled={materials.fields.length === 1} onClick={() => materials.remove(i)} className="flex h-11 w-11 items-center justify-center text-danger disabled:opacity-40"><Trash2 size={16} /></button></td>
          </tr>;
        })}</tbody>
      </table></div>
      {(err.materials?.message || err.materials?.root?.message) && <p role="alert" className="mt-2 text-sm text-danger">{err.materials.message || err.materials.root?.message}</p>}
      {!area && <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => materials.append(blank)} className="h-11 rounded-sm border border-border px-3 text-sm hover:bg-hover">+ Thêm nguyên vật liệu</button><ProductMultiPicker load={load("canUseAsMaterial")} existingIds={inputs.flatMap(l => l?.productId ? [l.productId] : [])} onPicked={addProducts} /></div>}
    </FormCard>
    <FormCard icon={Package} title="Sản phẩm đầu ra">
      {area && <p className="mb-3 text-sm text-fg-secondary">Xẻ dọc một nguyên liệu cùng vật liệu, độ dày; đơn vị gốc là mét dài. Chiều dài mỗi dải bằng chiều dài nguyên liệu. Phần còn lại dùng được cần thêm thành đầu ra thu hồi.</p>}
      <div className="overflow-x-auto rounded-sm border border-border"><table className="line-table w-full text-sm">
        <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="p-2">Sản phẩm</th>{area && <><th className="p-2 text-right">Khổ (mm)</th><th className="p-2 text-right">Số dải</th><th className="p-2 text-right">Dài mỗi dải (m)</th></>}<th className="p-2 text-right">Số lượng nhập</th>{!area && <th className="p-2 text-right">Trọng số</th>}<th className="p-2 text-right">Phân bổ</th><th /></tr></thead>
        <tbody>{outputRows.fields.map((row, i) => {
          const e = err.outputs?.[i], output = outputs[i], product = meta[output?.productId];
          return <tr key={row.id} className="border-t border-border">
            <td className="p-2" data-label="Sản phẩm" data-wide><Controller control={form.control} name={`outputs.${i}.productId`} render={({ field }) => <Combobox label={i === 0 ? "Sản phẩm đầu ra" : `Sản phẩm đầu ra dòng ${i + 1}`} value={product ?? null} loadOptions={load("canProduce")} onChange={o => field.onChange(o ? Number(o.value) : undefined)} error={e?.productId?.message} />} />
              {quickProduct && <QuickProductDialog config={quickProduct} defaultKind="PHU_KIEN" triggerLabel="Thêm phụ kiện Tôn" onCreated={p => { setMeta(current => ({ ...current, [p.value]: p })); form.setValue(`outputs.${i}.productId`, p.value, { shouldDirty: true, shouldValidate: true }); }} />}
            </td>
            {area && <>
              <td className="p-2" data-label="Khổ (mm)"><RhfNumberInput aria-label={`Khổ đầu ra dòng ${i + 1}`} maxFrac={3} control={form.control} name={`outputs.${i}.widthMm`} className={`${inputClass(e?.widthMm)} tabular text-right`} />{e?.widthMm && <p role="alert" className="text-sm text-danger">{e.widthMm.message}</p>}</td>
              <td className="p-2" data-label="Số dải"><RhfNumberInput aria-label={`Số dải dòng ${i + 1}`} maxFrac={0} control={form.control} name={`outputs.${i}.stripCount`} onBlur={() => syncOutputQty(i)} className={`${inputClass(e?.stripCount)} tabular text-right`} />{e?.stripCount && <p role="alert" className="text-sm text-danger">{e.stripCount.message}</p>}</td>
              <td className="p-2" data-label="Dài mỗi dải (m)"><RhfNumberInput aria-label={`Chiều dài mỗi dải dòng ${i + 1}`} maxFrac={3} control={form.control} name={`outputs.${i}.lengthM`} onBlur={() => syncOutputQty(i)} className={`${inputClass(e?.lengthM)} tabular text-right`} />{e?.lengthM && <p role="alert" className="text-sm text-danger">{e.lengthM.message}</p>}</td>
            </>}
            <td className="p-2" data-label="Số lượng nhập">{area ? <output className="block tabular text-right">{formatQty((output?.lengthM || 0) * (output?.stripCount || 1))} {product?.baseUnit}</output> : <><RhfNumberInput aria-label={`Số lượng thành phẩm dòng ${i + 1}`} maxFrac={3} control={form.control} name={`outputs.${i}.qty`} className={`${inputClass(e?.qty)} tabular text-right`} /><span className="block text-right text-xs text-fg-secondary">{product?.baseUnit}</span></>}{e?.qty && <p role="alert" className="text-sm text-danger">{e.qty.message}</p>}</td>
            {!area && <td className="p-2" data-label="Trọng số"><RhfNumberInput aria-label={`Trọng số phân bổ dòng ${i + 1}`} maxFrac={3} control={form.control} name={`outputs.${i}.allocationWeight`} className={`${inputClass(e?.allocationWeight)} tabular text-right`} />{e?.allocationWeight && <p role="alert" className="text-sm text-danger">{e.allocationWeight.message}</p>}</td>}
            <td className="p-2 text-right tabular" data-label="Phân bổ">{formatQty(totalWeight ? weights[i] / totalWeight * 100 : 0)}%</td>
            <td data-action><button type="button" aria-label={`Xóa đầu ra dòng ${i + 1}`} title="Xóa đầu ra" disabled={outputRows.fields.length === 1} onClick={() => outputRows.remove(i)} className="flex h-11 w-11 items-center justify-center text-danger disabled:opacity-40"><Trash2 size={16} /></button></td>
          </tr>;
        })}</tbody>
      </table></div>
      {(err.outputs?.message || err.outputs?.root?.message) && <p role="alert" className="mt-2 text-sm text-danger">{err.outputs.message || err.outputs.root?.message}</p>}
      {area && <p role="status" className={`mt-3 text-sm tabular ${remainingWidth < 0 ? "text-danger" : "text-fg-secondary"}`}>Khổ còn lại / hao hụt: {formatQty(remainingWidth)} mm. Phần chưa ghi nhận thành đầu ra được tính là hao hụt; chi phí phân bổ vào các đầu ra nhập kho.</p>}
      <button type="button" onClick={() => outputRows.append(blankOutput)} className="mt-3 h-11 rounded-sm border border-border px-3 text-sm hover:bg-hover">+ Thêm sản phẩm đầu ra</button>
    </FormCard>
  </NewPage>;
}