"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavModule } from "@/config/app.config";
import { resolveBreadcrumb } from "@/lib/nav";

export function Breadcrumb({ nav }: { nav: NavModule[] }) {
  const crumbs = resolveBreadcrumb(nav, usePathname());
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Đường dẫn" className="min-w-0">
      <ol className="flex items-center gap-1 text-sm text-fg-secondary">
        {crumbs.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight size={14} aria-hidden className="shrink-0 text-fg-muted" />}
            {c.href ? (
              <Link href={c.href} className="truncate hover:text-fg">{c.label}</Link>
            ) : (
              <span aria-current="page" className="truncate font-medium text-fg">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
