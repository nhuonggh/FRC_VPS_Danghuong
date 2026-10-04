"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { NewPage } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { purchaseInputSchema, type PurchaseInput } from "@/server/purchase/schemas";
import { dropEmptyPurchaseLines, emptyPurchaseLine, PurchaseHeaderFields, PurchaseLinesFields, PurchaseNoteField } from "./PurchaseFormFields";

/** Lập phiếu nhập: một trang — thông tin chung, danh sách sản phẩm, ghi chú. */
export function PurchaseNewForm({ today }: { today: string }) {
  const router = useRouter(), idem = useIdempotencyKey();
  const form = useForm<PurchaseInput>({ resolver: zodResolver(purchaseInputSchema), defaultValues: { partnerId: undefined, date: today, freightCost: 0, note: "", lines: [emptyPurchaseLine] } });
  const submit = form.handleSubmit(async (input) => { const result = await apiFetch<{ id: number }>("/api/purchases", { method: "POST", json: input, idempotencyKey: idem.key }); router.replace(`/purchase/orders/${result.id}`); });
  return (
    <NewPage backHref="/purchase/orders" backLabel="Quay lại phiếu nhập" title="Lập phiếu nhập" submitLabel="Lập phiếu" isDirty={() => form.formState.isDirty} onSubmit={async () => { dropEmptyPurchaseLines(form); await submit(); }}>
      <div className="space-y-6">
        <div className="space-y-5"><PurchaseHeaderFields form={form} maxDate={today} /><PurchaseNoteField form={form} /></div>
        <div className="space-y-3 border-t border-border pt-5">
          <h2 className="text-sm font-semibold">Danh sách sản phẩm</h2>
          <PurchaseLinesFields form={form} />
        </div>
      </div>
    </NewPage>
  );
}
