"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { FileText, ListChecks } from "lucide-react";
import { NewPage, tabsWithErrors, type FormTab } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { purchaseInputSchema, type PurchaseInput } from "@/server/purchase/schemas";
import { emptyPurchaseLine, PurchaseHeaderFields, PurchaseLinesFields, PurchaseNoteField } from "./PurchaseFormFields";

export function PurchaseNewForm({ today }: { today: string }) {
  const router = useRouter(), idem = useIdempotencyKey();
  const form = useForm<PurchaseInput>({ resolver: zodResolver(purchaseInputSchema), defaultValues: { partnerId: undefined, date: today, freightCost: 0, note: "", lines: [emptyPurchaseLine] } });
  const submit = form.handleSubmit(async (input) => { const result = await apiFetch<{ id: number }>("/api/purchases", { method: "POST", json: input, idempotencyKey: idem.key }); router.replace(`/purchase/orders/${result.id}`); });
  const tabs: FormTab[] = [
    { key: "chung", label: "Thông tin chung", icon: FileText, fields: ["partnerId", "date", "freightCost", "note"], render: () => <div className="space-y-5"><PurchaseHeaderFields form={form} maxDate={today} /><PurchaseNoteField form={form} /></div> },
    { key: "san-pham", label: "Danh sách sản phẩm", icon: ListChecks, fields: ["lines"], render: () => <PurchaseLinesFields form={form} /> },
  ];
  return <NewPage backHref="/purchase/orders" backLabel="Quay lại phiếu nhập" title="Lập phiếu nhập" submitLabel="Lập phiếu" isDirty={() => form.formState.isDirty} onSubmit={async () => { await submit(); }} tabs={tabs} errorTabs={tabsWithErrors(form.formState.errors, tabs)} />;
}
