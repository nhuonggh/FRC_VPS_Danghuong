"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
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
    resolver: zodResolver(createUserSchema), defaultValues: { username: "", fullName: "", roleIds: [] },
  });

  const submit = handleSubmit(async (v) => {
    let r: { id: number; tempPassword: string | null };
    try {
      // Cùng khoá cho mọi lần gửi lại của form này: bấm đúp / mất mạng rồi gửi lại không tạo 2 người
      r = await apiFetch<{ id: number; tempPassword: string | null }>("/api/users", { method: "POST", json: v, idempotencyKey: idem.key });
    } catch (e) {
      // 409 duy nhất khi tạo = trùng tên đăng nhập → báo ngay tại ô, giữ nguyên dữ liệu (không cần banner)
      if (e instanceof ApiError && e.status === 409) {
        setError("username", { message: e.message }, { shouldFocus: true });
        return;
      }
      throw e; // lỗi khác → banner của NewPage (giữ dữ liệu đang nhập)
    }
    // password null = phản hồi lặp (cùng Idempotency-Key): hộp thoại chỉ dẫn "Cấp lại mật khẩu"
    setCreated({ id: r.id, username: v.username.toLowerCase(), password: r.tempPassword });
  });

  return (
    <>
      <NewPage backHref="/system/users" backLabel="Quay lại người dùng" title="Tạo mới người dùng" submitLabel="Tạo người dùng"
        isDirty={() => isDirty && !created} onSubmit={async () => { await submit(); }}>
        <div className="space-y-5">
          <h2 className="text-base font-semibold">Thông tin đăng nhập</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="username" className="mb-1 block text-xs text-fg-muted">Tên đăng nhập</label>
              <input id="username" autoComplete="off" {...register("username")} aria-invalid={!!errors.username} aria-describedby={errors.username ? "username-error" : undefined}
                className={`h-11 w-full rounded-sm border bg-canvas px-3 text-sm md:h-9 ${errors.username ? "border-danger" : "border-border"}`} />
              {errors.username && <p id="username-error" className="mt-1 text-xs text-danger">{errors.username.message}</p>}
            </div>
            <div>
              <label htmlFor="fullName" className="mb-1 block text-xs text-fg-muted">Họ tên</label>
              <input id="fullName" {...register("fullName")} aria-invalid={!!errors.fullName} aria-describedby={errors.fullName ? "fullName-error" : undefined}
                className={`h-11 w-full rounded-sm border bg-canvas px-3 text-sm md:h-9 ${errors.fullName ? "border-danger" : "border-border"}`} />
              {errors.fullName && <p id="fullName-error" className="mt-1 text-xs text-danger">{errors.fullName.message}</p>}
            </div>
          </div>
          <h2 className="pt-2 text-base font-semibold">Nhóm quyền</h2>
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
          <p className="text-xs text-fg-muted">Hệ thống tự sinh mật khẩu tạm; người dùng phải đổi ở lần đăng nhập đầu.</p>
        </div>
      </NewPage>
      <TempPasswordDialog open={!!created} username={created?.username ?? ""} password={created?.password ?? null}
        onClose={() => { const id = created!.id; setCreated(null); router.replace(`/system/users/${id}`); }} />
    </>
  );
}
