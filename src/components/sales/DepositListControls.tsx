"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Combobox, filterComboOptions } from "@/components/ui/Combobox";
import { QuickTimeFilter } from "@/components/ui/QuickTimeFilter";
import { SearchBox } from "@/components/ui/SearchBox";
import { activeDepositTime, depositTimeOptions } from "@/lib/deposit-list";
import { formatNumber } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";

const BASE = "/sales/deposits";
export function DepositListControls({ params, customers, counts, now }: {
  params: ListParams; customers: { id: number; name: string }[]; counts: Record<string, number>; now: Date;
}) {
  const router = useRouter();
  const [pending, transition] = useTransition();
  const options = customers.map((c) => ({ value: String(c.id), label: c.name }));
  const active = activeDepositTime(params, now);
  return <div className="space-y-3 border-b border-border p-4">
    <div className="flex flex-wrap items-center gap-3">
      <SearchBox basePath={BASE} params={params} placeholder="Tìm mã phiếu, mã đơn, khách hàng…" className="sm:flex-1 [&_input]:min-h-11 md:[&_input]:min-h-10" />
      <div className="w-full sm:w-60 [&_input]:min-h-11 [&_button]:min-h-11 [&_button]:min-w-11 md:[&_input]:min-h-10">
        <Combobox label="Lọc theo khách hàng" hideLabel placeholder="Tất cả khách hàng" disabled={pending}
          value={options.find((o) => o.value === params.filters.customer?.[0]) ?? null}
          loadOptions={async (q) => filterComboOptions(options, q)}
          onChange={(o) => transition(() => router.push(buildListHref(BASE, params, { filters: { customer: o ? [String(o.value)] : [] } })))} />
      </div>
      <QuickTimeFilter basePath={BASE} params={params} now={now} />
    </div>
    <nav aria-label="Lọc nhanh theo ngày" className="flex flex-wrap gap-2">
      {depositTimeOptions(now).map((p) => <Link key={p.key} aria-current={active === p.key ? "page" : undefined} href={buildListHref(BASE, params, p.patch)}
        className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:min-h-9 ${active === p.key ? "border-accent bg-accent font-medium text-fg-on-accent" : "border-border bg-surface text-fg-secondary hover:bg-hover"}`}>
        {p.label}{" "}<span className={`rounded-full px-2 text-xs tabular-nums ${active === p.key ? "bg-surface text-accent" : "bg-accent-soft text-accent"}`}>{formatNumber(counts[p.key] ?? 0)}</span>
      </Link>)}
    </nav>
  </div>;
}
