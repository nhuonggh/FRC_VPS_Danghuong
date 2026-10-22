"use client";

import { useRouter } from "next/navigation";
import { shouldNavigateOnRowClick } from "@/components/ui/row-click";

/** Dòng bảng báo cáo: bấm cả dòng (hoặc Enter) → sang trang chi tiết. */
export function ClickableRow({ href, className, label, children }: { href: string; className?: string; label: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr
      tabIndex={0}
      aria-label={label}
      className={`cursor-pointer ${className ?? ""}`}
      onClick={(e) => { if (shouldNavigateOnRowClick(e, window.getSelection()?.toString() ?? "")) router.push(href); }}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) router.push(href); }}
    >
      {children}
    </tr>
  );
}
