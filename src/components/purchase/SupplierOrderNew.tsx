"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Truck } from "lucide-react";
import { FormCard, NewPage } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { purchaseInputSchema, type PurchaseInput } from "@/server/purchase/schemas";
import { supplierOrderSchema } from "@/server/supplier-orders/schemas";
import { dropEmptyPurchaseLines, emptyPurchaseLine, PurchaseHeaderFields, PurchaseLinesFields, PurchaseNoteField } from "./PurchaseFormFields";
export function SupplierOrderNew({ today }: { today: string }) {
  const router = useRouter(), idem = useIdempotencyKey();
  const [attachments, setAttachments] = useState<{ name: string; data: string }[]>([]), [uploadError, setUploadError] = useState("");
  const form = useForm<PurchaseInput>({ resolver: zodResolver(purchaseInputSchema), defaultValues: { date: today, freightCost: 0, note: "", lines: [emptyPurchaseLine] } });
  const submit = form.handleSubmit(async values => {
    const input = supplierOrderSchema.parse({ ...values, attachments, lines: values.lines.map(l => ({ ...l, expectedDate: l.expectedDate || null })) });
    const result = await apiFetch<{ id: number }>("/api/supplier-orders", { method: "POST", json: input, idempotencyKey: idem.key });
    form.reset(values); router.replace(`/purchase/supplier-orders/${result.id}`);
  });
  return <NewPage wide bare backHref="/purchase/supplier-orders" backLabel="Đơn đặt nhà cung cấp" title="Đặt hàng nhà cung cấp" submitLabel="Lưu đơn nháp" isDirty={() => form.formState.isDirty || attachments.length > 0} onSubmit={async () => { dropEmptyPurchaseLines(form); await submit(); }}>
    <FormCard icon={Truck} title="Thông tin đặt hàng"><PurchaseHeaderFields form={form} maxDate={today} ordering /><div className="mt-3"><PurchaseNoteField form={form} /></div><p className="mt-3 text-sm text-fg-secondary">Người thao tác được ghi tự động theo tài khoản. Sau khi đặt qua Zalo, mở đơn và đánh dấu đã gửi nhà cung cấp.</p></FormCard>
    <FormCard icon={Package} title="Sản phẩm cần đặt"><PurchaseLinesFields form={form} ordering /></FormCard>
    <FormCard icon={Package} title="Ảnh trao đổi / chứng từ"><label className="block text-sm">Tối đa 3 ảnh PNG, JPEG, WebP; mỗi ảnh tối đa 700 KB.<input type="file" accept="image/png,image/jpeg,image/webp" multiple className="mt-2 block min-h-11 w-full" onChange={async e => {
      const files = Array.from(e.target.files ?? []); e.target.value = ""; setUploadError("");
      if (attachments.length + files.length > 3 || files.some(f => f.size > 700000 || !["image/png", "image/jpeg", "image/webp"].includes(f.type))) { setUploadError("Chọn tối đa 3 ảnh, mỗi ảnh không quá 700 KB."); return; }
      try { const added = await Promise.all(files.map(file => new Promise<{ name: string; data: string }>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name.slice(0, 150), data: String(reader.result) }); reader.onerror = reject; reader.readAsDataURL(file); }))); setAttachments(current => [...current, ...added].slice(0, 3)); }
      catch { setUploadError("Không đọc được ảnh, hãy chọn lại."); }
    }} /></label>{uploadError && <p role="alert" className="text-sm text-danger">{uploadError}</p>}{attachments.map((a, i) => <div key={i} className="flex items-center justify-between text-sm"><span>{a.name}</span><button type="button" title="Gỡ ảnh" aria-label={`Gỡ ${a.name}`} className="h-11 w-11 text-danger" onClick={() => setAttachments(current => current.filter((_, j) => i !== j))}>×</button></div>)}</FormCard>
  </NewPage>;
}
