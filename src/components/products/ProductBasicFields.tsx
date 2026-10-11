"use client";
import { useState } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Combobox, filterComboOptions, igArea, igCombo, igInput, InlineField, type ComboOption } from "@/components/ui";
import { PRODUCT_KINDS, type CreateProductInput } from "@/server/products/schemas";
import { QuickCatalogAdd } from "./QuickCatalogAdd";

/** Các trường dùng chung của form tạo + form sửa "Thông tin cơ bản" (mã/tên do form ngoài dựng). */
export type BasicFormValues = Pick<CreateProductInput, "name" | "kind" | "baseUnit" | "isCoil" | "note" | "imageUrl" | "groupId" | "importUnit" | "exportUnit" | "bundleQty" | "qtyLabel">;
const num = { setValueAs: (v: unknown) => (v === "" || v == null ? null : Number(v)) };

export function ProductBasicFields({ form, groups, units, canCatalog, lockBaseUnit }: { form: UseFormReturn<BasicFormValues>; groups: ComboOption[]; units: string[]; canCatalog: boolean; lockBaseUnit?: boolean }) {
  const { register, control, setValue, formState: { errors } } = form;
  const [groupList, setGroupList] = useState(groups);
  const [unitList, setUnitList] = useState(units);
  const unitInput = (name: "baseUnit" | "importUnit" | "exportUnit", label: string, extra?: { required?: boolean; placeholder?: string }) => (
    <InlineField id={name} label={label} required={extra?.required} error={errors[name]?.message}>
      <input id={name} list="product-unit-options" autoComplete="off" disabled={name === "baseUnit" && lockBaseUnit} placeholder={extra?.placeholder} {...register(name)} className={igInput} />
      {canCatalog && !(name === "baseUnit" && lockBaseUnit) ? <QuickCatalogAdd section="units" label="Đơn vị tính" maxLength={10} onAdded={(u) => { setUnitList((l) => (l.includes(u.label) ? l : [...l, u.label])); setValue(name, u.label, { shouldDirty: true }); }} /> : null}
    </InlineField>
  );
  return (
    <div className="space-y-5">
      <datalist id="product-unit-options">{unitList.map((u) => <option key={u} value={u} />)}</datalist>
      <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
        <InlineField id="name" label="Tên sản phẩm" required error={errors.name?.message}><input id="name" {...register("name")} className={igInput} /></InlineField>
        <InlineField id="groupId" label="Nhóm sản phẩm">
          <div className={igCombo}><Controller control={control} name="groupId" render={({ field }) => <Combobox hideLabel label="Nhóm sản phẩm" value={groupList.find((g) => g.value === field.value) ?? null} onChange={(o) => field.onChange(o ? Number(o.value) : null)} loadOptions={async (q) => filterComboOptions(groupList, q)} placeholder="Chọn nhóm (tuỳ chọn)…" />} /></div>
          {canCatalog ? <QuickCatalogAdd section="product-groups" label="Nhóm sản phẩm" onAdded={(g) => { setGroupList((l) => [...l, g]); setValue("groupId", g.value, { shouldDirty: true }); }} /> : null}
        </InlineField>
        {unitInput("baseUnit", "Đơn vị gốc", { required: true })}
        <InlineField id="kind" label="Loại"><select id="kind" {...register("kind")} className={igInput}>{PRODUCT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></InlineField>
        {unitInput("importUnit", "Đơn vị tính nhập", { placeholder: "Trống = đơn vị gốc" })}
        {unitInput("exportUnit", "Đơn vị tính xuất", { placeholder: "Trống = đơn vị gốc" })}
        <InlineField id="bundleQty" label="Số cây/bó" error={errors.bundleQty?.message}><input id="bundleQty" type="number" min={0} step="any" {...register("bundleQty", num)} className={`${igInput} tabular text-right`} /></InlineField>
        <InlineField id="qtyLabel" label="Tên số lượng" error={errors.qtyLabel?.message}><input id="qtyLabel" maxLength={30} {...register("qtyLabel")} className={igInput} /></InlineField>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" {...register("isCoil")} />Sản phẩm là tôn (tôn cuộn)</label>
      </div>
      <InlineField id="imageUrl" label="Địa chỉ ảnh" hint="https://… hoặc /uploads/…" error={errors.imageUrl?.message}><input id="imageUrl" {...register("imageUrl")} className={igInput} /></InlineField>
      <InlineField id="note" label="Ghi chú" multiline><textarea id="note" rows={3} {...register("note")} className={igArea} /></InlineField>
    </div>
  );
}
