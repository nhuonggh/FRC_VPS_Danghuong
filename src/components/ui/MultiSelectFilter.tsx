"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { buildListHref, type ListParams } from "@/lib/query-params";

/** Lọc đa chọn theo query-param `paramKey` (giá trị nối bằng dấu phẩy). Mọi thay đổi về trang 1 (do buildListHref). */
export function MultiSelectFilter({
  label, paramKey, options, basePath, params,
}: {
  label: string;
  paramKey: string;
  options: { value: string; label: string }[];
  basePath: string;
  params: ListParams;
}) {
  const router = useRouter();
  const selected = params.filters[paramKey] ?? [];
  const toggle = (value: string) => {
    const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
    router.push(buildListHref(basePath, params, { filters: { [paramKey]: next } }));
  };
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="flex h-11 items-center gap-2 rounded-sm border border-border bg-canvas px-3 text-sm hover:bg-hover md:h-10">
        {label}
        {selected.length > 0 && <span className="tabular rounded-full bg-accent-soft px-1.5 text-xs font-semibold text-accent">{selected.length}</span>}
        <ChevronDown size={14} aria-hidden className="text-fg-muted" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="start" sideOffset={6} className="z-dropdown max-h-72 min-w-48 overflow-auto rounded-md border border-border bg-raised p-1 shadow-md">
          {options.map((o) => (
            <Dropdown.CheckboxItem key={o.value} checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)} onSelect={(e) => e.preventDefault()}
              className="flex h-11 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover md:h-9">
              <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-sm border border-border-strong">{selected.includes(o.value) && <Check size={12} />}</span>
              {o.label}
            </Dropdown.CheckboxItem>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
