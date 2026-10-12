"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { FileText, Package } from "lucide-react";
import { addPickedLines, Combobox, FormCard, FormGrid, igArea, igCombo, igInput, InlineField, inputClass, NewPage, ProductMultiPicker, useLineEntry, type ComboOption, RhfNumberInput } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { BOM_MAX_LINES, createBomVersionSchema, type CreateBomVersionInput } from "@/server/bom/schemas";

export type MaterialOption = ComboOption & { baseUnit?: string };

export interface BomFormDefaults {
  product: ComboOption | null;
  processingType: ComboOption | null;
  lines: { material: MaterialOption; qtyPerUnit: number }[];
  /** true khi BOM đã có phiên bản: ngày hiệu lực không được ở quá khứ (server cũng kiểm). */
  hasVersions: boolean;
}

const searchProducts = (role: "target" | "material") => (q: string) =>
  apiFetch<MaterialOption[]>(`/api/bom/options/products?role=${role}&q=${encodeURIComponent(q)}`);
const loadProcessingTypes = async (q: string) => {
  const all = await apiFetch<ComboOption[]>("/api/bom/options/processing-types");
  const needle = q.trim().toLowerCase();
  return needle ? all.filter((o) => o.label.toLowerCase().includes(needle)) : all;
};

const searchMaterialsForPicker = (q: string) => searchProducts("material")(q) as Promise<(MaterialOption & { value: number })[]>;
const emptyLine = { materialProductId: undefined, qtyPerUnit: undefined, note: "" } as unknown as CreateBomVersionInput["lines"][number];

/** Form tạo phiên bản định mức (D-19: không sửa bản cũ — mọi lưu = phiên bản mới). */
export function BomNewForm({ today, defaults }: { today: string; defaults: BomFormDefaults }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [product, setProduct] = useState(defaults.product);
  const [processingType, setProcessingType] = useState(defaults.processingType);
  // Nhớ NVL đã chọn theo id để hiện lại nhãn + đơn vị gốc trong ô/cột ĐVT
  const [materials, setMaterials] = useState(() => new Map(defaults.lines.map((l) => [Number(l.material.value), l.material])));

  const form = useForm<CreateBomVersionInput>({
    resolver: zodResolver(createBomVersionSchema),
    defaultValues: {
      productId: defaults.product ? Number(defaults.product.value) : undefined,
      processingTypeId: defaults.processingType ? Number(defaults.processingType.value) : undefined,
      validFrom: today,
      note: "",
      lines: defaults.lines.length
        ? defaults.lines.map((l) => ({ materialProductId: Number(l.material.value), qtyPerUnit: l.qtyPerUnit, note: "" }))
        : [emptyLine],
    },
  });
  const { control, register, handleSubmit, setError, getValues, watch, formState: { errors, isDirty } } = form;
  const { fields, append, remove, update } = useFieldArray({ control, name: "lines" });
  const lines = watch("lines");
  const entry = useLineEntry({ count: fields.length, getLines: () => getValues("lines"), append, remove, blank: emptyLine, isFilled: (l) => !!(l?.materialProductId || Number(l?.qtyPerUnit)), qtyLabel: (i) => `Định mức dòng ${i + 1}`, max: BOM_MAX_LINES });
  const addMaterials = (picked: (MaterialOption & { value: number })[]) => {
    setMaterials((cur) => new Map([...cur, ...picked.map((m) => [Number(m.value), m as MaterialOption] as const)]));
    addPickedLines(picked, getValues("lines").map((l) => ({ productId: l?.materialProductId })), (m) => ({ ...emptyLine, materialProductId: Number(m.value) }), { update, append: (vs) => append(vs) }, BOM_MAX_LINES);
  };

  const submit = handleSubmit(async (value) => {
    try {
      const r = await apiFetch<{ bomId: number }>("/api/bom", { method: "POST", json: value, idempotencyKey: idem.key });
      router.replace(`/production/bom/${r.bomId}?tab=versions`);
    } catch (error) {
      // 400/409 theo ô (vd trùng ngày hiệu lực): báo ngay tại ô và GIỮ dữ liệu đã nhập
      if (error instanceof ApiError && error.fields && (error.status === 409 || error.status === 400)) {
        for (const [name, message] of Object.entries(error.fields)) setError(name as never, { message }, { shouldFocus: true });
        return;
      }
      throw error;
    }
  });

  return (
    <NewPage
      bare wide backHref="/production/bom" backLabel="Quay lại định mức NVL" title="Tạo phiên bản định mức" submitLabel="Lưu phiên bản"
      isDirty={() => isDirty} onSubmit={async () => { entry.dropEmptyLines(); await submit(); }}>
      <FormCard icon={FileText} title="Thông tin định mức">
        <FormGrid>
          <InlineField id="productId" label="Thành phẩm" required error={errors.productId?.message}>
            <Controller control={control} name="productId" render={({ field }) => (
              <div className={igCombo}><Combobox hideLabel label="Thành phẩm" value={field.value ? product : null} loadOptions={searchProducts("target")} placeholder="Tìm mã, tên…"
                onChange={(o) => { setProduct(o); field.onChange(o ? Number(o.value) : undefined); }} /></div>
            )} />
          </InlineField>
          <InlineField id="processingTypeId" label="Kiểu gia công" required error={errors.processingTypeId?.message}>
            <Controller control={control} name="processingTypeId" render={({ field }) => (
              <div className={igCombo}><Combobox hideLabel label="Kiểu gia công" value={field.value ? processingType : null} loadOptions={loadProcessingTypes} placeholder="Chọn kiểu gia công…"
                onChange={(o) => { setProcessingType(o); field.onChange(o ? Number(o.value) : undefined); }} /></div>
            )} />
          </InlineField>
          <InlineField id="validFrom" label="Hiệu lực từ ngày" required error={errors.validFrom?.message}
            hint={defaults.hasVersions ? "Không được trước hôm nay" : "Phiên bản đầu tiên có thể chọn ngày quá khứ"} labelClass="sm:min-w-40">
            <input id="validFrom" type="date" {...(defaults.hasVersions ? { min: today } : {})} {...register("validFrom")} aria-invalid={!!errors.validFrom} className={igInput} />
          </InlineField>
          <InlineField id="note" label="Ghi chú phiên bản" multiline error={errors.note?.message} className="md:col-span-2 xl:col-span-3">
            <textarea id="note" rows={3} {...register("note")} className={igArea} />
          </InlineField>
        </FormGrid>
      </FormCard>
      <FormCard icon={Package} title="Nguyên vật liệu">
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-sm border border-border">
            <table className="line-table w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-hover text-left text-xs font-semibold text-fg-secondary">
                  <th className="px-2 py-2">Nguyên vật liệu</th>
                  <th className="px-2 py-2 text-right">Định mức / 1 đơn vị thành phẩm</th>
                  <th className="px-2 py-2">ĐVT</th>
                  <th className="px-2 py-2">Ghi chú</th>
                  <th aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {fields.map((field, index) => {
                  const err = errors.lines?.[index];
                  const id = lines[index]?.materialProductId;
                  const selected = id ? materials.get(id) ?? null : null;
                  return (
                    <tr key={field.id} className="border-b border-border align-top last:border-b-0">
                      <td className="min-w-64 px-2 py-2" data-line-product={index} data-label="Nguyên vật liệu" data-wide>
                        <Controller control={control} name={`lines.${index}.materialProductId`} render={({ field: f }) => (
                          <Combobox label={`Nguyên vật liệu dòng ${index + 1}`} value={selected} loadOptions={searchProducts("material")}
                            placeholder="Tìm mã, tên…" error={err?.materialProductId?.message}
                            onChange={(o) => {
                              f.onChange(o ? Number(o.value) : undefined);
                              if (o) { setMaterials((cur) => new Map(cur).set(Number(o.value), o as MaterialOption)); entry.onProductPicked(index); }
                            }} />
                        )} />
                      </td>
                      <td className="px-2 py-2" data-label="Định mức / 1 đv thành phẩm">
                        <RhfNumberInput aria-label={`Định mức dòng ${index + 1}`}
                          maxFrac={3} control={control} name={`lines.${index}.qtyPerUnit`} onKeyDown={entry.onQtyKeyDown(index)} className={`${inputClass(err?.qtyPerUnit)} tabular text-right`} />
                        {err?.qtyPerUnit?.message && <p role="alert" className="mt-1 text-xs text-danger">{err.qtyPerUnit.message}</p>}
                      </td>
                      <td className="px-2 py-2 text-fg-secondary" data-label="ĐVT">{selected?.baseUnit ?? "—"}</td>
                      <td className="px-2 py-2" data-label="Ghi chú" data-wide><input aria-label={`Ghi chú dòng ${index + 1}`} {...register(`lines.${index}.note`)} className={inputClass(err?.note)} /></td>
                      <td className="px-2 py-2" data-action>
                        <button type="button" aria-label={`Xóa dòng ${index + 1}`} onClick={() => remove(index)} disabled={fields.length === 1}
                          className="h-11 w-11 text-danger hover:bg-danger-soft disabled:opacity-40 md:h-9 md:w-9">×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-hover font-semibold">
                  <td className="px-2 py-3" colSpan={5}>Tổng: {lines.filter((l) => l?.materialProductId).length} nguyên vật liệu</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {errors.lines?.message && <p role="alert" className="text-sm text-danger">{errors.lines.message}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => append(emptyLine)} disabled={fields.length >= BOM_MAX_LINES}
              className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover disabled:opacity-40 md:h-10">+ Thêm dòng</button>
            <ProductMultiPicker load={searchMaterialsForPicker} disabled={fields.length >= BOM_MAX_LINES} existingIds={lines.flatMap((l) => (l?.materialProductId ? [l.materialProductId] : []))} onPicked={addMaterials} />
          </div>
        </div>
      </FormCard>
    </NewPage>
  );
}
