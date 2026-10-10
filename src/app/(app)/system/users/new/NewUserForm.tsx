"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { KeyRound, ShieldCheck } from "lucide-react";
import { FormCard, FormGrid, igInput, InlineField } from "@/components/ui";
import { NewPage } from "@/components/ui/NewPage";
import { TempPasswordDialog } from "@/components/ui/TempPasswordDialog";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { createUserSchema } from "@/server/users/schemas";

type Values = z.infer<typeof createUserSchema>;

export function NewUserForm({ roles }: { roles: { id: number; name: string; description: string | null }[] }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [created, setCreated] = useState<{ id: number; username: string; password: string | null } | null>(null);
  const { register, control, handleSubmit, setError, formState: { errors, isDirty } } = useForm<Values>({
    resolver: zodResolver(createUserSchema), defaultValues: { username: "", fullName: "", email: "", roleIds: [] },
  });

  const submit = handleSubmit(async (v) => {
    let r: { id: number; tempPassword: string | null };
    try {
      // Cùng khoá cho mọi lần gửi lại của form này: bấm đúp / mất mạng rồi gửi lại không tạo 2 người
      r = await apiFetch<{ id: number; tempPassword: string | null }>("/api/users", { method: "POST", json: v, idempotencyKey: idem.key });
    } catch (e) {
      // 409 khi tạo = trùng email (server gửi kèm fields.email) hoặc trùng tên đăng nhập → báo ngay tại ô, giữ dữ liệu
      if (e instanceof ApiError && e.status === 409) {
        if (e.fields?.email) setError("email", { message: e.fields.email }, { shouldFocus: true });
        else setError("username", { message: e.message }, { shouldFocus: true });
        return;
      }
      throw e; // lỗi khác → banner của NewPage (giữ dữ liệu đang nhập)
    }
    // password null = phản hồi lặp (cùng Idempotency-Key): hộp thoại chỉ dẫn "Cấp lại mật khẩu"
    setCreated({ id: r.id, username: v.username.toLowerCase(), password: r.tempPassword });
  });

  return (
    <>
      <NewPage bare backHref="/system/users" backLabel="Quay lại người dùng" title="Tạo mới người dùng" submitLabel="Tạo người dùng"
        isDirty={() => isDirty && !created} onSubmit={async () => { await submit(); }}>
        <FormCard icon={KeyRound} title="Thông tin đăng nhập">
          <FormGrid cols={2}>
            <InlineField id="username" label="Tên đăng nhập" error={errors.username?.message} labelClass="sm:min-w-40">
              <input id="username" autoComplete="off" {...register("username")} aria-invalid={!!errors.username} className={igInput} />
            </InlineField>
            <InlineField id="fullName" label="Họ tên" error={errors.fullName?.message} labelClass="sm:min-w-40">
              <input id="fullName" {...register("fullName")} aria-invalid={!!errors.fullName} className={igInput} />
            </InlineField>
            <InlineField id="email" label="Email đăng nhập Google (không bắt buộc)" error={errors.email?.message} hint="Có email → người này đăng nhập được bằng tài khoản Google đúng email đó." className="md:col-span-2" labelClass="sm:min-w-40">
              <input id="email" type="email" inputMode="email" autoComplete="off" {...register("email")} aria-invalid={!!errors.email} className={igInput} />
            </InlineField>
          </FormGrid>
        </FormCard>
        <FormCard icon={ShieldCheck} title="Nhóm quyền">
          <Controller control={control} name="roleIds" render={({ field }) => (
            <fieldset className="space-y-2" aria-describedby={errors.roleIds ? "roleIds-error" : undefined}>
              <legend className="sr-only">Nhóm quyền</legend>
              {roles.map((r) => (
                <label key={r.id} className="flex min-h-10 items-start gap-3 rounded-sm border border-border p-3 text-sm">
                  <input type="checkbox" checked={field.value.includes(r.id)}
                    onChange={(e) => field.onChange(e.target.checked ? [...field.value, r.id] : field.value.filter((x) => x !== r.id))} />
                  <span><span className="font-medium">{r.name}</span>{r.description && <span className="block text-xs text-fg-muted">{r.description}</span>}</span>
                </label>
              ))}
              {errors.roleIds && <p id="roleIds-error" className="text-xs text-danger">{errors.roleIds.message}</p>}
            </fieldset>
          )} />
          <p className="mt-3 text-xs text-fg-muted">Hệ thống tự sinh mật khẩu tạm; người dùng phải đổi ở lần đăng nhập đầu.</p>
        </FormCard>
      </NewPage>
      <TempPasswordDialog open={!!created} username={created?.username ?? ""} password={created?.password ?? null}
        onClose={() => { const id = created!.id; setCreated(null); router.replace(`/system/users/${id}`); }} />
    </>
  );
}
