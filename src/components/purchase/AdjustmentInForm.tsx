"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Package, PackagePlus } from "lucide-react";
import { addPickedLines, Combobox, FormCard, FormGrid, igInput, InlineField, NewPage, ProductMultiPicker, inputClass, useLineEntry, RhfNumberInput } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
// Schema thuần Zod: không import barrel service vì Client Component không được kéo engine FIFO vào bundle browser.
import { adjustmentInSchema, type AdjustmentInInput } from "@/server/purchase/adjustment-schemas";
import type { ProductOption } from "@/server/products/queries";
const blank = { productId: undefined, qty: undefined, unitCost: null } as unknown as AdjustmentInInput["lines"][number];
export function AdjustmentInForm({ today, canSetCost }: { today: string; canSetCost: boolean }) {
 const router = useRouter(), idem = useIdempotencyKey(), [meta, setMeta] = useState<Record<number, ProductOption>>({});
 const form = useForm<AdjustmentInInput>({ resolver: zodResolver(adjustmentInSchema), defaultValues: { date: today, note: "", lines: [blank] } }); const { fields, append, remove, update } = useFieldArray({ control: form.control, name: "lines" });
 const entry = useLineEntry({ count: fields.length, getLines: () => form.getValues("lines"), append, remove, blank, qtyLabel: (i) => `Số lượng dòng ${i + 1}` });
 const addProducts = (picked: ProductOption[]) => addPickedLines(picked, form.getValues("lines"), (p) => ({ ...blank, productId: p.value }), { update, append: (vs) => append(vs) });
 const load = async (q: string) => { const rows = await apiFetch<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(q)}`); setMeta((x) => ({ ...x, ...Object.fromEntries(rows.map((p) => [p.value, p])) })); return rows; };
 const submit = form.handleSubmit(async (value) => { const r = await apiFetch<{ id: number }>("/api/stock-adjustments-in", { method: "POST", json: value, idempotencyKey: idem.key }); router.replace(`/purchase/adjustments-in/${r.id}`); });
 const err = form.formState.errors;
 const lineIds = form.watch("lines").flatMap((l) => (l?.productId ? [l.productId as number] : []));
 return (
  <NewPage wide bare backHref="/purchase/adjustments-in" backLabel="Quay lại nhập kho không NCC" title="Nhập kho không NCC" submitLabel="Lưu phiếu" isDirty={() => form.formState.isDirty} onSubmit={async () => { entry.dropEmptyLines(); await submit(); }}>
   <FormCard icon={PackagePlus} title="Thông tin chung">
    <p className="mb-3 text-sm text-fg-secondary">Cho hàng lệch, hàng dư không theo nhà cung cấp; tạo lô FIFO mới và không sinh công nợ.</p>
    <FormGrid cols={2}>
     <InlineField id="date" label="Ngày nhập" error={err.date?.message}><input id="date" type="date" max={today} {...form.register("date")} aria-invalid={!!err.date} className={igInput} /></InlineField>
     <InlineField id="note" label="Ghi chú"><input id="note" {...form.register("note")} className={igInput} /></InlineField>
    </FormGrid>
   </FormCard>
   <FormCard icon={Package} title="Danh sách sản phẩm">
    <div className="space-y-3">
     <div className="overflow-x-auto rounded-sm border border-border">
      <table className="line-table w-full min-w-[620px] text-sm">
       <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-2 py-2">Sản phẩm</th><th className="px-2 py-2 text-right">Số lượng (đv gốc)</th>{canSetCost && <th className="px-2 py-2 text-right">Đơn giá vốn</th>}<th /></tr></thead>
       <tbody>
        {fields.map((field, i) => {
         const e = err.lines?.[i], p = meta[form.watch(`lines.${i}.productId`) as number];
         return (
          <tr key={field.id} className="border-t border-border">
           <td className="px-2 py-2" data-line-product={i} data-label="Sản phẩm" data-wide><Controller control={form.control} name={`lines.${i}.productId`} render={({ field: f }) => <Combobox label={`Sản phẩm dòng ${i + 1}`} value={p ?? null} loadOptions={load} onChange={(o) => { f.onChange(o ? Number(o.value) : undefined); if (o) entry.onProductPicked(i); }} error={e?.productId?.message} />} /></td>
           <td className="px-2 py-2" data-label="Số lượng (đv gốc)"><RhfNumberInput aria-label={`Số lượng dòng ${i + 1}`} maxFrac={3} control={form.control} name={`lines.${i}.qty`} onKeyDown={entry.onQtyKeyDown(i)} className={`${inputClass(e?.qty)} tabular text-right`} />{p && <span className="block text-right text-xs text-fg-muted">{p.baseUnit}</span>}</td>
           {canSetCost && <td className="px-2 py-2" data-label="Đơn giá vốn"><RhfNumberInput aria-label={`Đơn giá vốn dòng ${i + 1}`} maxFrac={2} placeholder="Giá nhập gần nhất" control={form.control} name={`lines.${i}.unitCost`} empty={null} className={`${inputClass(e?.unitCost)} tabular text-right`} /></td>}
           <td data-action><button type="button" aria-label={`Xóa dòng ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(i)} className="h-11 w-11 text-danger disabled:opacity-40">×</button></td>
          </tr>
         );
        })}
       </tbody>
      </table>
     </div>
     {err.lines?.message && <p role="alert" className="text-sm text-danger">{err.lines.message}</p>}
     <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => append(blank)} className="h-11 rounded-sm border border-border px-3 text-sm hover:bg-hover">+ Thêm dòng</button>
      <ProductMultiPicker load={load} existingIds={lineIds} onPicked={addProducts} />
     </div>
    </div>
   </FormCard>
  </NewPage>
 );
}
