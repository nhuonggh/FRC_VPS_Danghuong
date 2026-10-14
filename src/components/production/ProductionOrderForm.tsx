"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { Factory, Package } from "lucide-react";
import { addPickedLines, Combobox, FormCard, FormGrid, igCombo, igInput, InlineField, NewPage, ProductMultiPicker, inputClass, useLineEntry, RhfNumberInput } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
// Schema thuần Zod: không import service (kéo engine FIFO vào bundle browser).
import { productionOrderSchema, type ProductionOrderInput } from "@/server/production/schemas";
import type { ProductOption } from "@/server/products/queries";
import { QuickProductDialog, type QuickProductConfig } from "@/components/products/QuickProductDialog";

const blank = { productId: undefined, qty: undefined } as unknown as ProductionOrderInput["materials"][number];

export function ProductionOrderForm({ today, quickProduct }: { today: string; quickProduct?: QuickProductConfig }) {
  const router = useRouter(), idem = useIdempotencyKey();
  const [meta, setMeta] = useState<Record<number, ProductOption>>({});
  const form = useForm<ProductionOrderInput>({ resolver: zodResolver(productionOrderSchema), defaultValues: { date: today, note: "", materials: [blank] } });
  const { fields, append, remove, update } = useFieldArray({ control: form.control, name: "materials" });
  const entry = useLineEntry({ count: fields.length, getLines: () => form.getValues("materials"), append, remove, blank, qtyLabel: (i) => `Số lượng NVL dòng ${i + 1}` });
  const addProducts = (picked: ProductOption[]) => addPickedLines(picked, form.getValues("materials"), (p) => ({ ...blank, productId: p.value }), { update, append: (vs) => append(vs) });
  const load = (kinds: string) => async (q: string) => {
    const rows = await apiFetch<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(q)}&kinds=${kinds}`);
    setMeta((x) => ({ ...x, ...Object.fromEntries(rows.map((p) => [p.value, p])) }));
    return rows;
  };
  const submit = form.handleSubmit(async (value) => {
    const r = await apiFetch<{ id: number }>("/api/production/orders", { method: "POST", json: value, idempotencyKey: idem.key });
    router.replace(`/production/orders/${r.id}`);
  });
  const err = form.formState.errors;
  const target = meta[form.watch("productId") as number];
  const lineIds = form.watch("materials").flatMap((l) => (l?.productId ? [l.productId as number] : []));
  return (
    <NewPage wide bare backHref="/production/orders" backLabel="Quay lại lệnh sản xuất" title="Lập lệnh sản xuất phụ kiện" submitLabel="Lưu lệnh" isDirty={() => form.formState.isDirty} onSubmit={async () => { entry.dropEmptyLines(); await submit(); }}>
      <FormCard icon={Factory} title="Thông tin lệnh sản xuất">
        <p className="mb-3 text-sm text-fg-secondary">Xuất nguyên vật liệu theo FIFO và nhập phụ kiện thành phẩm; giá thành = tổng vốn nguyên vật liệu / số lượng. Chỉ dành cho phụ kiện (nóc, sườn, sối, máng…).</p>
        <FormGrid cols={2}>
          <InlineField id="date" label="Ngày sản xuất" required error={err.date?.message} labelClass="sm:min-w-40"><input id="date" type="date" max={today} {...form.register("date")} aria-invalid={!!err.date} className={igInput} /></InlineField>
          <InlineField id="note" label="Ghi chú" labelClass="sm:min-w-40"><input id="note" {...form.register("note")} className={igInput} /></InlineField>
          <InlineField id="productId" label="Phụ kiện" required error={err.productId?.message} labelClass="sm:min-w-40">
            <Controller control={form.control} name="productId" render={({ field }) => <div className={igCombo}><Combobox hideLabel label="Phụ kiện" value={target ?? null} loadOptions={load("PHU_KIEN")} onChange={(o) => field.onChange(o ? Number(o.value) : undefined)} /></div>} />
            {quickProduct && <div className="flex shrink-0 items-center border-l border-border px-1"><QuickProductDialog config={quickProduct} defaultKind="PHU_KIEN" triggerLabel="Thêm phụ kiện" onCreated={(p) => {
              setMeta((current) => ({ ...current, [p.value]: p }));
              form.setValue("productId", p.value, { shouldDirty: true, shouldValidate: true });
            }} /></div>}
          </InlineField>
          <InlineField id="qty" label={`Số lượng thành phẩm${target ? ` (${target.baseUnit})` : ""}`} required error={err.qty?.message} labelClass="sm:min-w-40"><RhfNumberInput id="qty" maxFrac={3} control={form.control} name={"qty"} aria-invalid={!!err.qty} className={`${igInput} tabular text-right`} /></InlineField>
        </FormGrid>
      </FormCard>
      <FormCard icon={Package} title="Nguyên vật liệu đã dùng">
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-sm border border-border">
            <table className="line-table w-full min-w-[520px] text-sm">
              <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-2 py-2">Nguyên vật liệu</th><th className="px-2 py-2 text-right">Số lượng (đv gốc)</th><th /></tr></thead>
              <tbody>
                {fields.map((field, i) => {
                  const e = err.materials?.[i], p = meta[form.watch(`materials.${i}.productId`) as number];
                  return (
                    <tr key={field.id} className="border-t border-border">
                      <td className="px-2 py-2" data-line-product={i} data-label="Nguyên vật liệu" data-wide><Controller control={form.control} name={`materials.${i}.productId`} render={({ field: f }) => <Combobox label={`Nguyên vật liệu dòng ${i + 1}`} value={p ?? null} loadOptions={load("NVL,HANG")} onChange={(o) => { f.onChange(o ? Number(o.value) : undefined); if (o) entry.onProductPicked(i); }} error={e?.productId?.message} />} /></td>
                      <td className="px-2 py-2" data-label="Số lượng (đv gốc)"><RhfNumberInput aria-label={`Số lượng NVL dòng ${i + 1}`} maxFrac={3} control={form.control} name={`materials.${i}.qty`} onKeyDown={entry.onQtyKeyDown(i)} className={`${inputClass(e?.qty)} tabular text-right`} />{p && <span className="block text-right text-xs text-fg-muted">{p.baseUnit}</span>}</td>
                      <td data-action><button type="button" aria-label={`Xóa dòng ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(i)} className="h-11 w-11 text-danger disabled:opacity-40">×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {err.materials?.message && <p role="alert" className="text-sm text-danger">{err.materials.message}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => append(blank)} className="h-11 rounded-sm border border-border px-3 text-sm hover:bg-hover">+ Thêm nguyên vật liệu</button>
            <ProductMultiPicker load={load("NVL,HANG")} existingIds={lineIds} onPicked={addProducts} />
          </div>
        </div>
      </FormCard>
    </NewPage>
  );
}
