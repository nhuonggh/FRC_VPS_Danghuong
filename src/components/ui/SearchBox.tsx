"use client";

import { startNavProgress } from "@/components/shell/NavProgress";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { buildListHref, MAX_QUERY_LENGTH, type ListParams } from "@/lib/query-params";

/**
 * Ô tìm kiếm (debounce 300ms, đẩy vào URL `q`, về trang 1). Server dựng where bằng `searchTextWhere(params.q)`.
 * `lastPushed` = giá trị q mà ô này đã đẩy/nhận từ URL: chỉ đẩy khi khác nó (StrictMode chạy effect 2 lần và
 * "gõ thêm khoảng trắng" không được làm mất trang đang xem), và chỉ ghi đè ô khi URL đổi từ bên ngoài.
 */
export function SearchBox({ basePath, params, placeholder = "Tìm kiếm…", className }: { basePath: string; params: ListParams; placeholder?: string; className?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(params.q ?? "");
  const lastPushed = useRef(params.q ?? "");

  useEffect(() => {
    const external = params.q ?? "";
    if (external !== lastPushed.current) {
      lastPushed.current = external;
      setValue(external);
    }
  }, [params.q]);

  useEffect(() => {
    const next = value.trim();
    if (next === lastPushed.current) return;
    const id = setTimeout(() => {
      lastPushed.current = next;
      startNavProgress();
      router.push(buildListHref(basePath, params, { q: next || undefined }));
    }, 300);
    return () => clearTimeout(id);
  }, [value, basePath, params, router]);

  return (
    <label className={clsx("relative block w-full sm:w-72", className)}>
      <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
      <input
        type="search"
        value={value}
        maxLength={MAX_QUERY_LENGTH}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label="Tìm kiếm"
        className="h-10 w-full rounded-sm border border-border bg-canvas pl-9 pr-3 text-sm"
      />
    </label>
  );
}
