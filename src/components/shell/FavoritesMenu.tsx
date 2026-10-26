"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Star } from "lucide-react";
import Link from "next/link";
import type { NavModule } from "@/config/app.config";
import { allPinned } from "@/lib/workspace";
import { useWorkspace } from "@/lib/workspace-store";
import { Icon } from "./icons";

/**
 * Yêu thích (chức năng đã ghim ở sidebar) dạng dropdown cạnh nút "Truy cập nhanh" trên header — trước đây là khối riêng đẩy
 * "Trang chủ" xuống trong sidebar. Không có mục ghim thì không hiện nút.
 */
export function FavoritesMenu({ nav }: { nav: NavModule[] }) {
  const prefs = useWorkspace((s) => s.prefs);
  const favorites = allPinned(nav, prefs);
  if (favorites.length === 0) return null;
  return (
    <Dropdown.Root>
      <Dropdown.Trigger title="Yêu thích" className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:px-3">
        <Star size={16} className="fill-current text-warning" aria-hidden />
        <span className="hidden sm:inline">Yêu thích</span><span className="sr-only sm:hidden">Yêu thích</span>
        <ChevronDown size={14} aria-hidden />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className="z-dropdown max-h-[70dvh] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-md border border-border bg-raised p-1 shadow-md">
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">Yêu thích</div>
          {favorites.map(({ module: m, fn: f }) => (
            <Dropdown.Item key={`${m.key}:${f.key}`} asChild>
              <Link href={f.path} className="flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover md:min-h-9">
                <Icon name={f.icon} size={16} /><span className="truncate">{f.label}</span><span className="ml-auto shrink-0 text-xs text-fg-muted">{m.label}</span>
              </Link>
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
