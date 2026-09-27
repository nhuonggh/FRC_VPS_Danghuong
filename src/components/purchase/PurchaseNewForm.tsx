"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { NewPage } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { purchaseInputSchema, type PurchaseInput } from "@/server/purchase/schemas";
import { emptyPurchaseLine, PurchaseFormFields } from "./PurchaseFormFields";

export function PurchaseNewForm({ today }: { today: string }) {
  const router = useRouter(), idem = useIdempotencyKey();
  const form = useForm<PurchaseInput>({ resolver: zodResolver(purchaseInputSchema), defaultValues: { partnerId: undefined, date: today, freightCost: 0, note: "", lines: [emptyPurchaseLine] } });
  const submit = form.handleSubmit(async (input) => { const result = await apiFetch<{ id: number }>("/api/purchases", { method: "POST", json: input, idempotencyKey: idem.key }); router.replace(`/purchase/orders/${result.id}`); });
  return <NewPage backHref="/purchase/orders" backLabel="Quay lại phiếu nhập" title="Lập phiếu nhập" submitLabel="Lập phiếu" isDirty={() => form.formState.isDirty} onSubmit={async () => { await submit(); }}><PurchaseFormFields form={form} maxDate={today} /></NewPage>;
}
