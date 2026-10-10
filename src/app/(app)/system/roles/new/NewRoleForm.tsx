"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { ShieldCheck } from "lucide-react";
import { FormCard, igArea, igInput, InlineField } from "@/components/ui";
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
    <NewPage bare backHref="/system/roles" backLabel="Quay lại nhóm quyền" title="Tạo mới nhóm quyền" submitLabel="Tạo nhóm quyền" isDirty={() => isDirty} onSubmit={async () => { await submit(); }}>
      <FormCard icon={ShieldCheck} title="Thông tin nhóm">
        <div className="space-y-3">
          <InlineField id="name" label="Tên nhóm quyền" error={errors.name?.message}>
            <input id="name" autoComplete="off" {...register("name")} aria-invalid={!!errors.name} className={igInput} />
          </InlineField>
          <InlineField id="description" label="Mô tả" multiline error={errors.description?.message}>
            <textarea id="description" rows={3} {...register("description")} aria-invalid={!!errors.description} className={igArea} />
          </InlineField>
          <p className="text-xs text-fg-muted">Sau khi tạo, hệ thống mở phần cấu hình quyền cho nhóm này.</p>
        </div>
      </FormCard>
    </NewPage>
  );
}
