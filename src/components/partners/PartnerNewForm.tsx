"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { Combobox, filterComboOptions, type ComboOption } from "@/components/ui/Combobox";
import { FileText, History, ReceiptText, Truck, Wallet } from "lucide-react";
import { igArea, igCombo, igInput, InlineField, NewPage, tabsWithErrors, type FormTab } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { PartnerKind } from "@/server/partners/codes";
import { createPartnerSchema, type CreatePartnerInput } from "@/server/partners/schemas";
import { KIND_UI } from "./kinds";
const loader = (options: ComboOption[]) => async (q: string) => filterComboOptions(options, q);
export function PartnerNewForm({ kind, groups, owners, canPickOwner }: { kind: PartnerKind; groups: ComboOption[]; owners: ComboOption[]; canPickOwner: boolean }) {
  const router = useRouter(), idem = useIdempotencyKey(), ui = KIND_UI[kind];
  const { register, control, handleSubmit, setError, formState: { errors, isDirty } } = useForm<CreatePartnerInput>({ resolver: zodResolver(createPartnerSchema), defaultValues: { code: "", name: "", groupId: undefined as never, isCustomer: kind === "customer", isSupplier: kind === "supplier", ownerUserId: null, debtLimit: 0, allowCredit: false, phone: "", address: "", taxCode: "", deliveryAddress: "", note: "", isActive: true } });
  const submit = handleSubmit(async (values) => { try { const result = await apiFetch<{ id: number }>("/api/partners", { method: "POST", json: values, idempotencyKey: idem.key }); router.replace(`${ui.base}/${result.id}`); } catch (error) { if (error instanceof ApiError && error.status === 409 && error.fields?.code) { setError("code", { message: error.fields.code }, { shouldFocus: true }); return; } throw error; } });
  const lock = (what: string) => <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">{what} sẽ hiện ở đây sau khi lưu.</p>;
  const tabs: FormTab[] = [
    { key: "co-ban", label: "Thông tin cơ bản", icon: FileText, fields: ["name", "code", "groupId", "ownerUserId", "phone", "address", "taxCode", "deliveryAddress", "isCustomer", "isSupplier", "note"], render: () => <div className="space-y-5"><div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
    <InlineField id="name" label="Tên" required error={errors.name?.message}><input id="name" autoComplete="off" {...register("name")} aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-error" : undefined} className={igInput} /></InlineField>
    <InlineField id="code" label="Mã" hint="Để trống để hệ thống tự cấp" error={errors.code?.message}><input id="code" autoComplete="off" {...register("code")} aria-invalid={!!errors.code} aria-describedby={errors.code ? "code-error" : "code-hint"} className={igInput} /></InlineField>
    <InlineField id="groupId" label="Nhóm"><div className={igCombo}><Controller control={control} name="groupId" render={({ field }) => <Combobox hideLabel label="Nhóm" value={groups.find((g) => g.value === field.value) ?? null} onChange={(value) => field.onChange(value ? Number(value.value) : undefined)} loadOptions={loader(groups)} placeholder="Chọn nhóm…" {...(errors.groupId?.message ? { error: errors.groupId.message } : {})} />} /></div></InlineField>
    {canPickOwner && <InlineField id="ownerUserId" label="Người phụ trách"><div className={igCombo}><Controller control={control} name="ownerUserId" render={({ field }) => <Combobox hideLabel label="Người phụ trách" value={owners.find((o) => o.value === field.value) ?? null} onChange={(value) => field.onChange(value ? Number(value.value) : null)} loadOptions={loader(owners)} placeholder="Chọn nhân viên…" />} /></div></InlineField>}
    <InlineField id="phone" label="Điện thoại" error={errors.phone?.message}><input id="phone" inputMode="tel" {...register("phone")} aria-invalid={!!errors.phone} className={igInput} /></InlineField>
    <InlineField id="address" label="Địa chỉ" error={errors.address?.message} className="md:col-span-2"><input id="address" {...register("address")} className={igInput} /></InlineField>
    <InlineField id="taxCode" label="Mã số thuế" error={errors.taxCode?.message}><input id="taxCode" {...register("taxCode")} className={igInput} /></InlineField>
    <InlineField id="deliveryAddress" label="Địa chỉ giao hàng" error={errors.deliveryAddress?.message}><input id="deliveryAddress" {...register("deliveryAddress")} className={igInput} /></InlineField>
    <fieldset className="flex flex-wrap gap-6 md:col-span-2"><legend className="sr-only">Loại đối tác</legend><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" {...register("isCustomer")} />Là khách hàng</label><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" {...register("isSupplier")} />Là nhà cung cấp</label>{errors.isCustomer && <p className="w-full text-xs text-danger">{errors.isCustomer.message}</p>}</fieldset>
  </div><InlineField id="note" label="Ghi chú" error={errors.note?.message} multiline><textarea id="note" rows={3} {...register("note")} className={igArea} /></InlineField></div> },
    { key: "cong-no", label: "Công nợ", icon: Wallet, fields: ["debtLimit", "allowCredit"], render: () => <div className="space-y-5"><div className="grid gap-x-6 gap-y-3 md:grid-cols-2"><InlineField id="debtLimit" label="Hạn mức nợ (₫)" error={errors.debtLimit?.message}><input id="debtLimit" type="number" inputMode="numeric" min={0} {...register("debtLimit", { valueAsNumber: true })} className={`${igInput} tabular text-right`} /></InlineField><label className="flex min-h-10 items-center gap-2 self-end text-sm"><input type="checkbox" {...register("allowCredit")} />Cho phép ghi nợ</label></div></div> },
    ...(kind === "customer"
      ? [
          { key: "lich-su-mua", label: "Lịch sử mua hàng", icon: History, disabled: true, disabledHint: "Lưu trước để xem", readOnly: true, render: () => lock("Lịch sử mua hàng") },
          { key: "bao-gia-don", label: "Báo giá & đơn hàng", icon: ReceiptText, disabled: true, disabledHint: "Lưu trước để xem", readOnly: true, render: () => lock("Báo giá và đơn hàng") },
        ]
      : [{ key: "lich-su-nhap", label: "Lịch sử nhập hàng", icon: Truck, disabled: true, disabledHint: "Lưu trước để xem", readOnly: true, render: () => lock("Lịch sử nhập hàng") }]),
  ];
  return <NewPage backHref={ui.base} backLabel={`Quay lại ${ui.title.toLowerCase()}`} title={`Thêm ${ui.singular}`} isDirty={() => isDirty} onSubmit={async () => { await submit(); }} tabs={tabs} errorTabs={tabsWithErrors(errors, tabs)} />;
}
