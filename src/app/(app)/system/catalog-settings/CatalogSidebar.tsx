import clsx from "clsx";
import Link from "next/link";
import { CATALOG_SECTIONS, type CatalogKey } from "@/config/catalog-sections";

export function CatalogSidebar({ selected, counts }: { selected: CatalogKey; counts: Record<CatalogKey, number> }) {
  return (
    <nav aria-label="Loại danh mục" className="flex overflow-x-auto rounded-md border border-border bg-surface p-2 lg:block lg:w-56 lg:shrink-0">
      {CATALOG_SECTIONS.map((section) => (
        <Link key={section.key} href={`/system/catalog-settings?section=${section.key}`} aria-current={section.key === selected ? "page" : undefined}
          className={clsx("flex min-h-11 shrink-0 items-center justify-between gap-3 rounded-sm px-3 text-sm lg:w-full", section.key === selected ? "bg-accent-soft font-medium text-accent" : "text-fg-secondary hover:bg-hover hover:text-fg")}>
          <span>{section.label}</span><span className="tabular text-xs text-fg-muted">{counts[section.key]}</span>
        </Link>
      ))}
    </nav>
  );
}
