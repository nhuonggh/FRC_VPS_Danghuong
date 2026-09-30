"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText, ListChecks } from "lucide-react";
import { Combobox, Field, NewPage, inputClass, tabsWithErrors, type FormTab } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
// Schema thuần Zod: không import barrel service vì Client Component không được kéo engine FIFO vào bundle browser.
import { adjustmentInSchema, type AdjustmentInInput } from "@/server/purchase/adjustment-schemas";
import type { ProductOption } from "@/server/products/queries";
const blank = { productId: undefined, qty: undefined, unitCost: null } as unknown as AdjustmentInInput["lines"][number];
export function AdjustmentInForm({ today, canSetCost }: { today: string; canSetCost: boolean }) {
 const router = useRouter(), idem = useIdempotencyKey(), [meta, setMeta] = useState<Record<number, ProductOption>>({});
 const form = useForm<AdjustmentInInput>({ resolver: zodResolver(adjustmentInSchema), defaultValues: { date: today, note: "", lines: [blank] } }); const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
 const load = async (q: string) => { const rows = await apiFetch<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(q)}`); setMeta((x) => ({ ...x, ...Object.fromEntries(rows.map((p) => [p.value, p])) })); return rows; };
 const submit = form.handleSubmit(async (value) => { const r = await apiFetch<{ id: number }>("/api/stock-adjustments-in", { method: "POST", json: value, idempotencyKey: idem.key }); router.replace(`/purchase/adjustments-in/${r.id}`); });
 const tabs: FormTab[] = [
  { key: "chung", label: "Thông tin chung", icon: FileText, fields: ["date", "note"], render: () => <div className="space-y-5"><p className="text-sm text-fg-secondary">Cho hàng lệch, hàng dư không theo nhà cung cấp; tạo lô FIFO mới và không sinh công nợ.</p><div className="grid gap-4 sm:grid-cols-2"><Field id="date" label="Ngày nhập" error={form.formState.errors.date?.message}><input id="date" type="date" max={today} {...form.register("date")} className={inputClass(form.formState.errors.date)} /></Field><Field id="note" label="Ghi chú"><input id="note" {...form.register("note")} className={inputClass()} /></Field></div></div> },
  { key: "san-pham", label: "Danh sách sản phẩm", icon: ListChecks, fields: ["lines"], render: () => <div className="space-y-5"><div className="overflow-x-auto rounded-sm border border-border"><table className="w-full min-w-[620px] text-sm"><thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-2 py-2">Sản phẩm</th><th className="px-2 py-2 text-right">Số lượng (đv gốc)</th>{canSetCost && <th className="px-2 py-2 text-right">Đơn giá vốn</th>}<th /></tr></thead><tbody>{fields.map((field, i) => { const e = form.formState.errors.lines?.[i], p = meta[form.watch(`lines.${i}.productId`) as number]; return <tr key={field.id} className="border-t border-border"><td className="px-2 py-2"><Controller control={form.control} name={`lines.${i}.productId`} render={({ field: f }) => <Combobox label={`Sản phẩm dòng ${i + 1}`} value={p ?? null} loadOptions={load} onChange={(o) => f.onChange(o ? Number(o.value) : undefined)} error={e?.productId?.message} />} /></td><td className="px-2 py-2"><input aria-label={`Số lượng dòng ${i + 1}`} type="number" min={0} step="any" {...form.register(`lines.${i}.qty`, { valueAsNumber: true })} className={`${inputClass(e?.qty)} tabular text-right`} />{p && <span className="block text-right text-xs text-fg-muted">{p.baseUnit}</span>}</td>{canSetCost && <td className="px-2 py-2"><input aria-label={`Đơn giá vốn dòng ${i + 1}`} type="number" min={0} step="any" placeholder="Giá nhập gần nhất" {...form.register(`lines.${i}.unitCost`, { setValueAs: (v) => v === "" ? null : Number(v) })} className={`${inputClass(e?.unitCost)} tabular text-right`} /></td>}<td><button type="button" aria-label={`Xóa dòng ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(i)} className="h-11 w-11 text-danger disabled:opacity-40">×</button></td></tr>; })}</tbody></table></div><button type="button" onClick={() => append(blank)} className="h-11 rounded-sm border border-border px-3 text-sm hover:bg-hover">+ Thêm dòng</button></div> },
 ];
 return <NewPage backHref="/purchase/adjustments-in" backLabel="Quay lại nhập kho không NCC" title="Nhập kho không NCC" submitLabel="Lưu phiếu" isDirty={() => form.formState.isDirty} onSubmit={async () => { await submit(); }} tabs={tabs} errorTabs={tabsWithErrors(form.formState.errors, tabs)} />;
}
