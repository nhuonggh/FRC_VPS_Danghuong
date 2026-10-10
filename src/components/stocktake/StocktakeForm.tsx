"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { ClipboardCheck, Package } from "lucide-react";
import { addPickedLines, Combobox, FormCard, FormGrid, igInput, InlineField, NewPage, ProductMultiPicker, inputClass, useLineEntry } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
// Schema thuần Zod: không import service (kéo engine FIFO vào bundle browser).
import { stocktakeSchema, type StocktakeInput } from "@/server/stocktake/schemas";
import type { ProductOption } from "@/server/products/queries";

const blank = { productId: undefined, actualQty: undefined } as unknown as StocktakeInput["lines"][number];
export interface StocktakeFormInitial { id: number; date: string; note: string; lines: { productId: number; label: string; hint: string; baseUnit: string; actualQty: number }[] }

export function StocktakeForm({ today, initial }: { today: string; initial?: StocktakeFormInitial }) {
  const router = useRouter();
  const [meta, setMeta] = useState<Record<number, ProductOption>>(() => Object.fromEntries((initial?.lines ?? []).map((l) => [l.productId, { value: l.productId, label: l.label, hint: l.hint, baseUnit: l.baseUnit, units: [] } as ProductOption])));
  const form = useForm<StocktakeInput>({
    resolver: zodResolver(stocktakeSchema),
    defaultValues: initial ? { date: initial.date, note: initial.note, lines: initial.lines.map((l) => ({ productId: l.productId, actualQty: l.actualQty })) } : { date: today, note: "", lines: [blank] },
  });
  const { fields, append, remove, update } = useFieldArray({ control: form.control, name: "lines" });
  const entry = useLineEntry({ count: fields.length, getLines: () => form.getValues("lines"), append, remove, blank, qtyLabel: (i) => `Tồn thực đếm dòng ${i + 1}` });
  const addProducts = (picked: ProductOption[]) => addPickedLines(picked, form.getValues("lines"), (p) => ({ ...blank, productId: p.value }), { update, append: (vs) => append(vs) });
  const load = async (q: string) => {
    const rows = await apiFetch<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(q)}`);
    setMeta((x) => ({ ...x, ...Object.fromEntries(rows.map((p) => [p.value, p])) }));
    return rows;
  };
  const submit = form.handleSubmit(async (value) => {
    const r = await apiFetch<{ id: number }>(initial ? `/api/stocktakes/${initial.id}` : "/api/stocktakes", { method: initial ? "PUT" : "POST", json: value });
    router.replace(`/inventory/stocktakes/${r.id}`);
  });
  const err = form.formState.errors;
  const lineIds = form.watch("lines").flatMap((l) => (l?.productId ? [l.productId as number] : []));
  return (
    <NewPage bare backHref="/inventory/stocktakes" backLabel="Quay lại kiểm kho" title={initial ? "Sửa phiếu kiểm kho (nháp)" : "Lập phiếu kiểm kho"} submitLabel="Lưu nháp" isDirty={() => form.formState.isDirty} onSubmit={async () => { entry.dropEmptyLines(); await submit(); }}>
      <FormCard icon={ClipboardCheck} title="Thông tin kiểm kho">
        <p className="mb-3 text-sm text-fg-secondary">Nhập tồn thực đếm (đơn vị gốc). Lưu nháp chưa đổi kho; khi bấm “Chốt” hệ thống so với tồn sổ sách và tự nhập/xuất phần chênh lệch.</p>
        <FormGrid cols={2}>
          <InlineField id="date" label="Ngày kiểm kho" required error={err.date?.message} labelClass="sm:min-w-40"><input id="date" type="date" max={today} {...form.register("date")} aria-invalid={!!err.date} className={igInput} /></InlineField>
          <InlineField id="note" label="Ghi chú" labelClass="sm:min-w-40"><input id="note" {...form.register("note")} className={igInput} /></InlineField>
        </FormGrid>
      </FormCard>
      <FormCard icon={Package} title="Danh sách sản phẩm">
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-sm border border-border">
            <table className="line-table w-full min-w-[520px] text-sm">
              <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-2 py-2">Sản phẩm</th><th className="px-2 py-2 text-right">Tồn thực đếm (đv gốc)</th><th /></tr></thead>
              <tbody>
                {fields.map((field, i) => {
                  const e = err.lines?.[i], p = meta[form.watch(`lines.${i}.productId`) as number];
                  return (
                    <tr key={field.id} className="border-t border-border">
                      <td className="px-2 py-2" data-line-product={i} data-label="Sản phẩm" data-wide><Controller control={form.control} name={`lines.${i}.productId`} render={({ field: f }) => <Combobox label={`Sản phẩm dòng ${i + 1}`} value={p ?? null} loadOptions={load} onChange={(o) => { f.onChange(o ? Number(o.value) : undefined); if (o) entry.onProductPicked(i); }} error={e?.productId?.message} />} /></td>
                      <td className="px-2 py-2" data-label="Tồn thực đếm (đv gốc)"><input aria-label={`Tồn thực đếm dòng ${i + 1}`} type="number" min={0} step="any" {...form.register(`lines.${i}.actualQty`, { valueAsNumber: true })} onKeyDown={entry.onQtyKeyDown(i)} className={`${inputClass(e?.actualQty)} tabular text-right`} />{p && <span className="block text-right text-xs text-fg-muted">{p.baseUnit}</span>}</td>
                      <td data-action><button type="button" aria-label={`Xóa dòng ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(i)} className="h-11 w-11 text-danger disabled:opacity-40">×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {err.lines?.message && <p role="alert" className="text-sm text-danger">{err.lines.message}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => append(blank)} className="h-11 rounded-sm border border-border px-3 text-sm hover:bg-hover">+ Thêm sản phẩm</button>
            <ProductMultiPicker load={load} existingIds={lineIds} onPicked={addProducts} />
          </div>
        </div>
      </FormCard>
    </NewPage>
  );
}
