"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { FileText, ListChecks } from "lucide-react";
import { Combobox, Field, NewPage, inputClass, tabsWithErrors, type FormTab } from "@/components/ui";
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
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
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
  const tabs: FormTab[] = [
    { key: "chung", label: "Thông tin chung", icon: FileText, fields: ["date","note"], render: () => (<div className="space-y-5">
        <p className="text-sm text-fg-secondary">Nhập tồn thực đếm (đơn vị gốc). Lưu nháp chưa đổi kho; khi bấm “Chốt” hệ thống so với tồn sổ sách và tự nhập/xuất phần chênh lệch.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="date" label="Ngày kiểm kho" required error={err.date?.message}><input id="date" type="date" max={today} {...form.register("date")} className={inputClass(err.date)} /></Field>
          <Field id="note" label="Ghi chú"><input id="note" {...form.register("note")} className={inputClass()} /></Field>
        </div>
    </div>) },
    { key: "san-pham", label: "Danh sách sản phẩm", icon: ListChecks, fields: ["lines"], render: () => (<div className="space-y-5">
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-2 py-2">Sản phẩm</th><th className="px-2 py-2 text-right">Tồn thực đếm (đv gốc)</th><th /></tr></thead>
            <tbody>
              {fields.map((field, i) => {
                const e = err.lines?.[i], p = meta[form.watch(`lines.${i}.productId`) as number];
                return (
                  <tr key={field.id} className="border-t border-border">
                    <td className="px-2 py-2"><Controller control={form.control} name={`lines.${i}.productId`} render={({ field: f }) => <Combobox label={`Sản phẩm dòng ${i + 1}`} value={p ?? null} loadOptions={load} onChange={(o) => f.onChange(o ? Number(o.value) : undefined)} error={e?.productId?.message} />} /></td>
                    <td className="px-2 py-2"><input aria-label={`Tồn thực đếm dòng ${i + 1}`} type="number" min={0} step="any" {...form.register(`lines.${i}.actualQty`, { valueAsNumber: true })} className={`${inputClass(e?.actualQty)} tabular text-right`} />{p && <span className="block text-right text-xs text-fg-muted">{p.baseUnit}</span>}</td>
                    <td><button type="button" aria-label={`Xóa dòng ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(i)} className="h-11 w-11 text-danger disabled:opacity-40">×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {err.lines?.message && <p role="alert" className="text-sm text-danger">{err.lines.message}</p>}
        <button type="button" onClick={() => append(blank)} className="h-11 rounded-sm border border-border px-3 text-sm hover:bg-hover">+ Thêm sản phẩm</button>
    </div>) },
  ];
  return (
    <NewPage backHref="/inventory/stocktakes" backLabel="Quay lại kiểm kho" title={initial ? "Sửa phiếu kiểm kho (nháp)" : "Lập phiếu kiểm kho"} submitLabel="Lưu nháp" isDirty={() => form.formState.isDirty} onSubmit={async () => { await submit(); }} tabs={tabs} errorTabs={tabsWithErrors(form.formState.errors, tabs)} />
  );
}
