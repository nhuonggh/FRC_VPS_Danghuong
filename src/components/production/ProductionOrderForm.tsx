"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { FileText, Package } from "lucide-react";
import { Combobox, Field, NewPage, inputClass, tabsWithErrors, type FormTab } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
// Schema thuần Zod: không import service (kéo engine FIFO vào bundle browser).
import { productionOrderSchema, type ProductionOrderInput } from "@/server/production/schemas";
import type { ProductOption } from "@/server/products/queries";

const blank = { productId: undefined, qty: undefined } as unknown as ProductionOrderInput["materials"][number];

export function ProductionOrderForm({ today }: { today: string }) {
  const router = useRouter(), idem = useIdempotencyKey();
  const [meta, setMeta] = useState<Record<number, ProductOption>>({});
  const form = useForm<ProductionOrderInput>({ resolver: zodResolver(productionOrderSchema), defaultValues: { date: today, note: "", materials: [blank] } });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "materials" });
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
  const tabs: FormTab[] = [
    { key: "chung", label: "Thông tin chung", icon: FileText, fields: ["date","note","productId","qty"], render: () => (<div className="space-y-5">
        <p className="text-sm text-fg-secondary">Xuất nguyên vật liệu theo FIFO và nhập phụ kiện thành phẩm; giá thành = tổng vốn nguyên vật liệu / số lượng. Chỉ dành cho phụ kiện (nóc, sườn, sối, máng…).</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="date" label="Ngày sản xuất" required error={err.date?.message}><input id="date" type="date" max={today} {...form.register("date")} className={inputClass(err.date)} /></Field>
          <Field id="note" label="Ghi chú"><input id="note" {...form.register("note")} className={inputClass()} /></Field>
          <Field id="productId" label="Phụ kiện" required error={err.productId?.message}>
            <Controller control={form.control} name="productId" render={({ field }) => <Combobox label="Phụ kiện" value={target ?? null} loadOptions={load("PHU_KIEN")} onChange={(o) => field.onChange(o ? Number(o.value) : undefined)} />} />
          </Field>
          <Field id="qty" label={`Số lượng thành phẩm${target ? ` (${target.baseUnit})` : ""}`} required error={err.qty?.message}><input id="qty" type="number" min={0} step="any" {...form.register("qty", { valueAsNumber: true })} className={`${inputClass(err.qty)} tabular text-right`} /></Field>
        </div>
    </div>) },
    { key: "nvl", label: "Nguyên vật liệu", icon: Package, fields: ["materials"], render: () => (<div className="space-y-5">
        <h2 className="text-sm font-semibold">Nguyên vật liệu đã dùng</h2>
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-2 py-2">Nguyên vật liệu</th><th className="px-2 py-2 text-right">Số lượng (đv gốc)</th><th /></tr></thead>
            <tbody>
              {fields.map((field, i) => {
                const e = err.materials?.[i], p = meta[form.watch(`materials.${i}.productId`) as number];
                return (
                  <tr key={field.id} className="border-t border-border">
                    <td className="px-2 py-2"><Controller control={form.control} name={`materials.${i}.productId`} render={({ field: f }) => <Combobox label={`Nguyên vật liệu dòng ${i + 1}`} value={p ?? null} loadOptions={load("NVL,HANG")} onChange={(o) => f.onChange(o ? Number(o.value) : undefined)} error={e?.productId?.message} />} /></td>
                    <td className="px-2 py-2"><input aria-label={`Số lượng NVL dòng ${i + 1}`} type="number" min={0} step="any" {...form.register(`materials.${i}.qty`, { valueAsNumber: true })} className={`${inputClass(e?.qty)} tabular text-right`} />{p && <span className="block text-right text-xs text-fg-muted">{p.baseUnit}</span>}</td>
                    <td><button type="button" aria-label={`Xóa dòng ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(i)} className="h-11 w-11 text-danger disabled:opacity-40">×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {err.materials?.message && <p role="alert" className="text-sm text-danger">{err.materials.message}</p>}
        <button type="button" onClick={() => append(blank)} className="h-11 rounded-sm border border-border px-3 text-sm hover:bg-hover">+ Thêm nguyên vật liệu</button>
    </div>) },
  ];
  return (
    <NewPage backHref="/production/orders" backLabel="Quay lại lệnh sản xuất" title="Lập lệnh sản xuất phụ kiện" submitLabel="Lưu lệnh" isDirty={() => form.formState.isDirty} onSubmit={async () => { await submit(); }} tabs={tabs} errorTabs={tabsWithErrors(form.formState.errors, tabs)} />
  );
}
