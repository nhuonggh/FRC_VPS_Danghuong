"use client";

import { useRouter } from "next/navigation";
import { Combobox, filterComboOptions, type ComboOption } from "@/components/ui";
import { buildListHref, type ListParams } from "@/lib/query-params";

export function BankAccountFilter({ accounts, selected, params }: { accounts: { id: number; name: string; bankNo: string | null }[]; selected: number | null; params: ListParams }) {
  const router = useRouter();
  const options: ComboOption[] = [{ value: "all", label: "Tất cả tài khoản" }, ...accounts.map((a) => ({ value: String(a.id), label: a.name, hint: a.bankNo ?? undefined }))];
  return <div className="w-full sm:w-64"><Combobox label="Tài khoản nhận tiền" hideLabel value={options.find((a) => a.value === String(selected)) ?? options[0]!} loadOptions={async (q) => filterComboOptions(options, q)} onChange={(o) => router.push(buildListHref("/?tab=accounting", params, { filters: { bankAccount: o && o.value !== "all" ? [String(o.value)] : [] } }))} /></div>;
}
