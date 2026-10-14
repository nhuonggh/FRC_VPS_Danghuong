import Link from "next/link";
import { visibleAccountingSections, type AccountingSection } from "@/lib/accounting-dashboard";
import { buildListHref, type ListParams } from "@/lib/query-params";

export function AccountingTabs({ perms, active, params }: { perms: ReadonlySet<string>; active: AccountingSection; params: ListParams }) {
  return <nav aria-label="Nhóm báo cáo kế toán" className="overflow-x-auto border-b border-border">
    <ul className="flex min-w-max gap-1">{visibleAccountingSections(perms).map((s) => <li key={s.key}>
      <Link href={buildListHref("/?tab=accounting", params, { filters: { accountingSection: [s.key] } })} scroll={false} aria-current={s.key === active ? "page" : undefined} className={`inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-4 text-sm font-medium focus-visible:outline focus-visible:outline-accent ${s.key === active ? "border-accent text-accent" : "border-transparent text-fg-secondary hover:bg-hover hover:text-fg"}`}>{s.label}</Link>
    </li>)}</ul>
  </nav>;
}
