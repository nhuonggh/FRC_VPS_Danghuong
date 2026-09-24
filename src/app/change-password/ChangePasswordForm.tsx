"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { toast } from "@/lib/toast";
import { changePasswordSchema } from "@/server/users/schemas";

type Values = z.infer<typeof changePasswordSchema>;

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current: "", next: "", confirm: "" },
  });

  const onSubmit = handleSubmit(async (v) => {
    try {
      // `confirm` chỉ để đối chiếu trên form — không gửi lên máy chủ
      await apiFetch("/api/account/change-password", { method: "POST", json: { current: v.current, next: v.next } });
    } catch (e) {
      setError("root", { message: e instanceof ApiError ? e.message : "Không đổi được mật khẩu, vui lòng thử lại." });
      return;
    }
    toast.success("Đã đổi mật khẩu.");
    // Cờ mustChangePassword đọc từ DB mỗi request (JWT chỉ giữ id) → về "/" là vào được hệ thống
    router.replace("/");
    router.refresh();
  });

  const field = (name: keyof Values, label: string, autoComplete: string) => (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={name} type="password" autoComplete={autoComplete} {...register(name)} aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `${name}-error` : undefined}
        className={`h-11 w-full rounded-sm border bg-canvas px-3 text-sm hover:border-border-strong ${errors[name] ? "border-danger" : "border-border"}`} />
      {errors[name] && <p id={`${name}-error`} className="mt-1 text-xs text-danger">{errors[name]!.message}</p>}
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {errors.root && (
        <div role="alert" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">{errors.root.message}</div>
      )}
      {field("current", forced ? "Mật khẩu tạm (được cấp)" : "Mật khẩu hiện tại", "current-password")}
      {field("next", "Mật khẩu mới", "new-password")}
      {field("confirm", "Nhập lại mật khẩu mới", "new-password")}
      <p className="text-xs text-fg-muted">Tối thiểu 8 ký tự, gồm cả chữ và số, không chứa tên đăng nhập.</p>
      <button type="submit" disabled={isSubmitting} className="h-11 w-full rounded-sm bg-accent text-sm font-medium text-fg-on-accent disabled:opacity-60">
        {isSubmitting ? "Đang lưu" : "Đổi mật khẩu"}
      </button>
    </form>
  );
}
