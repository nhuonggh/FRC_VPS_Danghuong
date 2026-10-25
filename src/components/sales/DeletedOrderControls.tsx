"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Combobox, filterComboOptions } from "@/components/ui/Combobox";
import { QuickTimeFilter } from "@/components/ui/QuickTimeFilter";
import { SearchBox } from "@/components/ui/SearchBox";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { TIME_PRESETS } from "@/lib/time-presets";
import { formatNumber } from "@/lib/format";

const BASE = "/sales/orders-deleted";
export function DeletedOrderControls({ params, customers, counts, now }: {
  params: ListParams; customers: { id: number; name: string }[]; counts: Record<string, number>; now: Date;
}) {
  const router = useRouter();
  const [pending, transition] = useTransition();
  const options = customers.map((c) => ({ value: String(c.id), label: c.name }));
  const presets = [{ value: "all" as ListParams["timePreset"], label: "Tất cả" }, ...TIME_PRESETS.filter((p) => p.value !== "custom")];
  return <div className="space-y-3 border-b border-border p-4">
    <div className="flex flex-wrap items-center gap-3">
      <SearchBox basePath={BASE} params={params} placeholder="Tìm mã đơn, khách hàng, lý do…" className="sm:flex-1" />
      <div className="w-full sm:w-60 [&_input]:min-h-11 [&_button]:min-h-11 [&_button]:min-w-11 md:[&_input]:min-h-10">
        <Combobox label="Lọc theo khách hàng" hideLabel placeholder="Tất cả khách hàng" disabled={pending}
          value={options.find((o) => o.value === params.filters.customer?.[0]) ?? null}
          loadOptions={async (q) => filterComboOptions(options, q)}
          onChange={(o) => transition(() => router.push(buildListHref(BASE, params, { filters: { customer: o ? [String(o.value)] : [] } })))} />
      </div>
      <QuickTimeFilter basePath={BASE} params={params} now={now} />
    </div>
    <div role="group" aria-label="Lọc nhanh theo thời điểm hủy" className="flex flex-wrap gap-2">
      {presets.map((p) => <Link key={p.value ?? "all"} aria-current={params.timePreset === p.value ? "true" : undefined}
        href={buildListHref(BASE, params, { timePreset: p.value, timeStart: undefined, timeEnd: undefined })}
        className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:min-h-9 ${params.timePreset === p.value ? "border-accent bg-accent font-medium text-fg-on-accent" : "border-border bg-surface text-fg-secondary hover:bg-hover"}`}>
        {p.label}<span className={`rounded-full px-2 text-xs tabular-nums ${params.timePreset === p.value ? "bg-surface text-accent" : "bg-accent-soft text-accent"}`}>{formatNumber(counts[p.value ?? "all"] ?? 0)}</span>
      </Link>)}
    </div>
    <p className="text-xs text-fg-secondary">Đang lọc theo <strong className="font-semibold text-fg">thời điểm hủy</strong>: {TIME_PRESETS.find((p) => p.value === params.timePreset)?.label ?? "Tất cả"}</p>
  </div>;
}
