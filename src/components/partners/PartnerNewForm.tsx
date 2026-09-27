"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { Combobox, filterComboOptions, type ComboOption } from "@/components/ui/Combobox";
import { Field, inputClass, NewPage } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { PartnerKind } from "@/server/partners/codes";
import { createPartnerSchema, type CreatePartnerInput } from "@/server/partners/schemas";
import { KIND_UI } from "./kinds";
const loader = (options: ComboOption[]) => async (q: string) => filterComboOptions(options, q);
export function PartnerNewForm({ kind, groups, owners, canPickOwner }: { kind: PartnerKind; groups: ComboOption[]; owners: ComboOption[]; canPickOwner: boolean }) {
  const router = useRouter(), idem = useIdempotencyKey(), ui = KIND_UI[kind];
  const { register, control, handleSubmit, setError, formState: { errors, isDirty } } = useForm<CreatePartnerInput>({ resolver: zodResolver(createPartnerSchema), defaultValues: { code: "", name: "", groupId: undefined as never, isCustomer: kind === "customer", isSupplier: kind === "supplier", ownerUserId: null, debtLimit: 0, allowCredit: false, phone: "", address: "", note: "", isActive: true } });
  const submit = handleSubmit(async (values) => { try { const result = await apiFetch<{ id: number }>("/api/partners", { method: "POST", json: values, idempotencyKey: idem.key }); router.replace(`${ui.base}/${result.id}`); } catch (error) { if (error instanceof ApiError && error.status === 409 && error.fields?.code) { setError("code", { message: error.fields.code }, { shouldFocus: true }); return; } throw error; } });
  return <NewPage backHref={ui.base} backLabel={`Quay lại ${ui.title.toLowerCase()}`} title={`Thêm ${ui.singular}`} isDirty={() => isDirty} onSubmit={async () => { await submit(); }}><div className="space-y-5"><h2 className="text-base font-semibold">Thông tin cơ bản</h2><div className="grid gap-4 sm:grid-cols-2">
    <Field id="name" label="Tên" required error={errors.name?.message}><input id="name" autoComplete="off" {...register("name")} aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-error" : undefined} className={inputClass(errors.name)} /></Field>
    <Field id="code" label="Mã" hint="Để trống để hệ thống tự cấp" error={errors.code?.message}><input id="code" autoComplete="off" {...register("code")} aria-invalid={!!errors.code} aria-describedby={errors.code ? "code-error" : "code-hint"} className={inputClass(errors.code)} /></Field>
    <Controller control={control} name="groupId" render={({ field }) => <Combobox label="Nhóm" value={groups.find((g) => g.value === field.value) ?? null} onChange={(value) => field.onChange(value ? Number(value.value) : undefined)} loadOptions={loader(groups)} placeholder="Chọn nhóm…" {...(errors.groupId?.message ? { error: errors.groupId.message } : {})} />} />
    {canPickOwner && <Controller control={control} name="ownerUserId" render={({ field }) => <Combobox label="Người phụ trách" value={owners.find((o) => o.value === field.value) ?? null} onChange={(value) => field.onChange(value ? Number(value.value) : null)} loadOptions={loader(owners)} placeholder="Chọn nhân viên…" />} />}
    <Field id="phone" label="Điện thoại" error={errors.phone?.message}><input id="phone" inputMode="tel" {...register("phone")} aria-invalid={!!errors.phone} className={inputClass(errors.phone)} /></Field>
    <Field id="address" label="Địa chỉ" error={errors.address?.message} className="sm:col-span-2"><input id="address" {...register("address")} className={inputClass(errors.address)} /></Field>
    <fieldset className="flex flex-wrap gap-6 sm:col-span-2"><legend className="sr-only">Loại đối tác</legend><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" {...register("isCustomer")} />Là khách hàng</label><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" {...register("isSupplier")} />Là nhà cung cấp</label>{errors.isCustomer && <p className="w-full text-xs text-danger">{errors.isCustomer.message}</p>}</fieldset>
  </div><h2 className="pt-2 text-base font-semibold">Công nợ</h2><div className="grid gap-4 sm:grid-cols-2"><Field id="debtLimit" label="Hạn mức nợ (₫)" error={errors.debtLimit?.message}><input id="debtLimit" type="number" inputMode="numeric" min={0} {...register("debtLimit", { valueAsNumber: true })} className={`${inputClass(errors.debtLimit)} tabular text-right`} /></Field><label className="flex min-h-10 items-center gap-2 self-end text-sm"><input type="checkbox" {...register("allowCredit")} />Cho phép ghi nợ</label></div><Field id="note" label="Ghi chú" error={errors.note?.message}><textarea id="note" rows={3} {...register("note")} className="w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" /></Field></div></NewPage>;
}
