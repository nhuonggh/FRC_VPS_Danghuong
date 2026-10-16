"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Combobox, filterComboOptions } from "@/components/ui/Combobox";
import { buildListHref, type ListParams } from "@/lib/query-params";

export function DailyPartnerFilter({ basePath, params, partners }: { basePath: string; params: ListParams; partners: string[] }) {
  const router = useRouter();
  const [pending, transition] = useTransition();
  const selected = params.filters.partner?.[0];
  const options = [...new Set([...partners, ...(selected ? [selected] : [])])].map((name) => ({ value: name, label: name }));
  return <div className="w-full sm:w-64 [&_input]:min-h-11 [&_button]:min-h-11 [&_button]:min-w-11">
    <Combobox label="Khách hàng / nhà cung cấp" hideLabel placeholder="Tất cả khách hàng / NCC" disabled={pending}
      value={selected ? { value: selected, label: selected } : null}
      loadOptions={async (q) => filterComboOptions(options, q)}
      onChange={(o) => transition(() => router.push(buildListHref(basePath, params, { filters: { partner: o ? [String(o.value)] : [] } })))} />
  </div>;
}

export function DailyEmptyToggle({ basePath, params, count }: { basePath: string; params: ListParams; count: number }) {
  const router = useRouter();
  const [pending, transition] = useTransition();
  return <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fg-secondary">
    <input type="checkbox" checked={params.filters.showEmpty?.[0] !== "1"} disabled={pending} className="h-4 w-4 accent-accent"
      onChange={(e) => transition(() => router.push(buildListHref(basePath, params, { filters: { showEmpty: e.target.checked ? [] : ["1"] } })))} />
    Ẩn mục không có dữ liệu <span className="tabular-nums">({count})</span>
  </label>;
}
