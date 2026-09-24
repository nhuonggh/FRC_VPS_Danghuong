"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  const fromUrl = params.filters[paramKey] ?? [];
  const urlKey = fromUrl.join(",");
  // Lựa chọn hiển thị = trạng thái cục bộ (lạc quan): bấm nhanh 2 lần khi router.push chưa xong thì lần 2 vẫn dựng
  // URL từ lựa chọn MỚI NHẤT chứ không từ `params` cũ (nếu không, lần bấm 1 bị mất). URL đổi thật (bộ lọc khác /
  // "Xóa bộ lọc" / điều hướng) → đồng bộ lại từ URL.
  const [selected, setSelected] = useState(fromUrl);
  const latest = useRef(selected);
  useEffect(() => {
    const next = urlKey ? urlKey.split(",") : [];
    latest.current = next;
    setSelected(next);
  }, [urlKey]);
  const toggle = (value: string) => {
    const cur = latest.current;
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    latest.current = next;
    setSelected(next);
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
