"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { NewPage } from "@/components/ui/NewPage";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { roleInfoSchema } from "@/server/roles/schemas";

type Values = z.infer<typeof roleInfoSchema>;

export function NewRoleForm() {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const created = useRef(false); // đã tạo xong, đang chuyển trang: mọi lần gửi thêm (Enter/bấm nút) bị bỏ qua
  const { register, handleSubmit, setError, formState: { errors, isDirty } } = useForm<Values>({ resolver: zodResolver(roleInfoSchema), defaultValues: { name: "", description: "" } });
  const submit = handleSubmit(async (v) => {
    if (created.current) return;
    let r: { id: number };
    try {
      r = await apiFetch<{ id: number }>("/api/roles", { method: "POST", json: v, idempotencyKey: idem.key });
    } catch (e) {
      // 409 duy nhất khi tạo nhóm = trùng tên → báo ngay tại ô, giữ dữ liệu
      if (e instanceof ApiError && e.status === 409) {
        setError("name", { message: e.message }, { shouldFocus: true });
        return;
      }
      throw e; // lỗi khác → banner của NewPage (giữ dữ liệu đang nhập)
    }
    created.current = true;
    router.replace(`/system/roles/${r.id}?edit=permissions`); // tạo xong: vào thẳng phần cấu hình quyền
  });
  return (
    <NewPage backHref="/system/roles" backLabel="Quay lại nhóm quyền" title="Tạo mới nhóm quyền" submitLabel="Tạo nhóm quyền" isDirty={() => isDirty} onSubmit={async () => { await submit(); }}>
      <div className="space-y-4">
        <h2 className="text-base font-semibold">Thông tin nhóm</h2>
        <div>
          <label htmlFor="name" className="mb-1 block text-xs text-fg-muted">Tên nhóm quyền</label>
          <input id="name" autoComplete="off" {...register("name")} aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-error" : undefined}
            className={`h-11 w-full rounded-sm border bg-canvas px-3 text-sm md:h-9 ${errors.name ? "border-danger" : "border-border"}`} />
          {errors.name && <p id="name-error" className="mt-1 text-xs text-danger">{errors.name.message}</p>}
        </div>
        <div>
          <label htmlFor="description" className="mb-1 block text-xs text-fg-muted">Mô tả</label>
          <textarea id="description" rows={3} {...register("description")} aria-invalid={!!errors.description} aria-describedby={errors.description ? "description-error" : undefined}
            className={`w-full rounded-sm border bg-canvas px-3 py-2 text-sm ${errors.description ? "border-danger" : "border-border"}`} />
          {errors.description && <p id="description-error" className="mt-1 text-xs text-danger">{errors.description.message}</p>}
        </div>
        <p className="text-xs text-fg-muted">Sau khi tạo, hệ thống mở phần cấu hình quyền cho nhóm này.</p>
      </div>
    </NewPage>
  );
}
