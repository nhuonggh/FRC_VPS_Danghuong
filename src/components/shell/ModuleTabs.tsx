"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import clsx from "clsx";
import { ChevronDown, Loader2, Star, X } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { NavModule } from "@/config/app.config";
import { confirmLeaveIfDirty } from "@/lib/dirty-guard";
import { FUNCTIONS_TAB, moduleForPath, reorderPins, setActive, tabsFor, togglePin } from "@/lib/workspace";
import { useWorkspace } from "@/lib/workspace-store";
import { GuardedLink } from "./GuardedLink";
import { Icon } from "./icons";

/**
 * Thanh tab của một module (điều hướng cấp 1 trong module): [Chức năng] [tab đã ghim…] [tab tạm thời].
 * Khác tab chi tiết `?tab=` ở trang bản ghi (FormTabs, dạng dọc/pill): đây là tab NGANG phía trên nội dung, mỗi tab = một route.
 * Tab tạm thời được suy ra từ URL (chức năng đang mở mà chưa ghim) ⇒ luôn tối đa một tab, mở chức năng khác thì tự thay.
 */
export function ModuleTabs({ nav }: { nav: NavModule[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const prefs = useWorkspace((s) => s.prefs);
  const update = useWorkspace((s) => s.update);
  const here = useMemo(() => moduleForPath(nav, pathname), [nav, pathname]);
  const [pending, setPending] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const moduleKey = here?.module.key;
  const fnKey = here?.fn?.key ?? null;

  // Nhớ chức năng đang làm (khôi phục khi quay lại module) và dọn trạng thái "đang chuyển tab".
  useEffect(() => { setPending(null); if (moduleKey) update((p) => setActive(p, moduleKey, fnKey ?? undefined)); }, [pathname, moduleKey, fnKey, update]);
  // Cuộn tab đang hoạt động vào vùng nhìn thấy khi thanh tab tràn.
  useEffect(() => { listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [pathname, prefs]);

  if (!here) return null;
  const { module } = here;
  const tabs = tabsFor(module, prefs, fnKey);
  const activeKey = fnKey ?? FUNCTIONS_TAB;
  const pinnedKeys = tabs.filter((t) => t.kind === "pinned").map((t) => t.key);

  const move = (key: string, to: number) => { const order = pinnedKeys.filter((k) => k !== key); order.splice(Math.max(0, Math.min(to, order.length)), 0, key); update((p) => reorderPins(p, module.key, order)); };
  const onDrop = (e: DragEvent, target: string) => { e.preventDefault(); if (dragKey && dragKey !== target) move(dragKey, pinnedKeys.indexOf(target)); setDragKey(null); };
  const onKey = (e: KeyboardEvent, key: string) => {
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault(); const at = pinnedKeys.indexOf(key); if (at >= 0) move(key, at + (e.key === "ArrowLeft" ? -1 : 1));
  };
  async function closeTemp() { if (await confirmLeaveIfDirty()) router.push(`/m/${module.key}`); }

  const tabCls = (on: boolean) => clsx("flex h-10 max-w-[14rem] items-center gap-2 border-b-2 px-3 text-sm transition-colors", on ? "border-accent font-semibold text-accent" : "border-transparent text-fg-secondary hover:bg-hover hover:text-fg");
  return (
    <div className="flex shrink-0 items-stretch border-b border-border bg-surface px-1 md:px-3" data-testid="module-tabs">
      <div ref={listRef} role="tablist" aria-label={`Chức năng ${module.label}`} className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:thin]">
        {tabs.map((t) => {
          const on = t.key === activeKey;
          return (
            <div key={t.key} role="presentation" className={clsx("group flex shrink-0 items-stretch", dragKey === t.key && "opacity-50")}
              draggable={t.kind === "pinned"} onDragStart={() => setDragKey(t.key)} onDragEnd={() => setDragKey(null)}
              onDragOver={(e) => { if (dragKey && t.kind === "pinned") e.preventDefault(); }} onDrop={(e) => t.kind === "pinned" && onDrop(e, t.key)}>
              <GuardedLink href={t.href} role="tab" aria-selected={on} title={t.kind === "temp" ? `${t.label} (tab tạm — bấm ngôi sao để ghim)` : t.label}
                onClick={() => { if (t.key !== activeKey) setPending(t.key); }} onKeyDown={(e) => onKey(e, t.key)}
                className={clsx(tabCls(on), t.kind === "temp" && "italic", "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent")}>
                {pending === t.key ? <Loader2 size={16} className="animate-spin" aria-hidden /> : t.icon ? <Icon name={t.icon} size={16} /> : <Icon name="layers" size={16} />}
                <span className="truncate">{t.label}</span>
              </GuardedLink>
              {t.kind !== "functions" && (
                <button type="button" aria-label={t.kind === "pinned" ? `Bỏ ghim ${t.label}` : `Ghim ${t.label}`} aria-pressed={t.kind === "pinned"} title={t.kind === "pinned" ? "Bỏ ghim" : "Ghim tab này"}
                  onClick={() => update((p) => togglePin(p, module.key, t.key))}
                  className={clsx("flex w-7 items-center justify-center border-b-2 text-fg-muted hover:text-warning focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", on ? "border-accent" : "border-transparent")}>
                  <Star size={14} className={t.kind === "pinned" ? "fill-current text-warning" : ""} aria-hidden />
                </button>
              )}
              {t.kind === "temp" && (
                <button type="button" aria-label={`Đóng ${t.label}`} onClick={() => void closeTemp()} className={clsx("flex w-7 items-center justify-center border-b-2 text-fg-muted hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", on ? "border-accent" : "border-transparent")}>
                  <X size={14} aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Dropdown.Root>
        <Dropdown.Trigger aria-label="Tất cả tab" title="Tất cả tab" className="flex w-9 shrink-0 items-center justify-center text-fg-secondary hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          <ChevronDown size={16} aria-hidden />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content align="end" className="z-dropdown max-h-80 min-w-52 overflow-y-auto rounded-md border border-border bg-raised p-1 shadow-md">
            {tabs.map((t) => (
              <Dropdown.Item key={t.key} asChild>
                <GuardedLink href={t.href} className={clsx("flex h-11 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover md:h-9", t.key === activeKey && "font-semibold text-accent")}>
                  <span className="truncate">{t.label}</span>{t.kind === "temp" && <span className="text-xs text-fg-muted">(tạm)</span>}
                </GuardedLink>
              </Dropdown.Item>
            ))}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  );
}
