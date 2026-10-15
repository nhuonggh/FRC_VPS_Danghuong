"use client";

import clsx from "clsx";
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Star } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavModule } from "@/config/app.config";
import { findActiveFunction } from "@/lib/nav";
import { allPinned, restoreHref, setSidebarCollapsed } from "@/lib/workspace";
import { useWorkspace } from "@/lib/workspace-store";
import { APP_NAME } from "@/lib/version";
import { GuardedLink as Link } from "./GuardedLink";
import { Icon } from "./icons";

const OPEN_KEY = "nav-open"; // trạng thái mở accordion: persist theo PHIÊN (sessionStorage)

export function Sidebar({ nav }: { nav: NavModule[] }) {
  const pathname = usePathname();
  const active = findActiveFunction(nav, pathname);
  const prefs = useWorkspace((s) => s.prefs);
  const update = useWorkspace((s) => s.update);
  const collapsed = !!prefs.sidebarCollapsed; // lưu theo tài khoản (DB), không còn theo trình duyệt
  const favorites = allPinned(nav, prefs);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(OPEN_KEY);
      if (raw) setOpen(JSON.parse(raw));
    } catch {
      /* storage bị chặn: dùng mặc định */
    }
  }, []);

  // Module chứa chức năng đang active tự expand
  useEffect(() => {
    if (active) setOpen((o) => (o[active.module.key] ? o : { ...o, [active.module.key]: true }));
  }, [active?.module.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleModule = (key: string) =>
    setOpen((o) => {
      const next = { ...o, [key]: !o[key] };
      try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* bỏ qua */ }
      return next;
    });

  const toggleCollapsed = () => update((p) => setSidebarCollapsed(p, !p.sidebarCollapsed));

  return (
    <aside
      aria-label="Điều hướng chính"
      className={clsx(
        "z-sidebar hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 ease-standard md:flex",
        // 768–1023: tự thu về icon rail; ≥1024: theo lựa chọn người dùng
        collapsed ? "w-16" : "w-16 lg:w-64",
      )}
    >
      <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-3">
        <span className="flex min-w-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={28} height={28} className="size-7 shrink-0" />
          <span className={clsx("truncate text-sm font-semibold", collapsed ? "hidden" : "hidden lg:block")}>{APP_NAME}</span>
        </span>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}
          className="hidden h-8 w-8 items-center justify-center rounded-sm text-fg-secondary hover:bg-hover lg:flex"
        >
          {collapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {favorites.length > 0 && (
          <div className="mb-2 border-b border-border pb-2" aria-label="Yêu thích">
            {collapsed ? (
              <button type="button" title="Yêu thích — mở rộng thanh bên để xem" aria-label="Yêu thích" onClick={toggleCollapsed} className="flex h-10 w-full items-center justify-center rounded-sm text-warning hover:bg-hover"><Star size={18} className="fill-current" aria-hidden /></button>
            ) : (
              <>
                <div className="hidden items-center gap-2 px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary lg:flex"><Star size={14} className="fill-current text-warning" aria-hidden />Yêu thích</div>
                <div className="hidden lg:block">
                  {favorites.map(({ module: m, fn: f }) => {
                    const on = active?.fn.key === f.key && active.module.key === m.key;
                    return (
                      <Link key={`${m.key}:${f.key}`} href={f.path} title={`${m.label} › ${f.label}`} aria-current={on ? "page" : undefined} className={clsx("flex h-9 items-center gap-2 rounded-sm border-l-[3px] px-3 text-sm", on ? "border-accent bg-accent-soft font-medium text-accent" : "border-transparent text-fg-secondary hover:bg-hover")}>
                        <Icon name={f.icon} size={16} /><span className="truncate">{f.label}</span><span className="ml-auto truncate text-xs text-fg-muted">{m.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
        {nav.map((m) => {
          const isActiveModule = active?.module.key === m.key || (m.type === "flat" && pathname === m.path);
          const expanded = !collapsed && m.type === "accordion" && open[m.key];
          const href = m.type === "flat" ? m.path! : restoreHref(m, prefs); // về lại chức năng đang làm dở nếu còn hợp lệ
          return (
            <div key={m.key} className="mb-0.5">
              <div
                className={clsx(
                  "flex h-10 items-center rounded-sm border-l-[3px]",
                  isActiveModule && m.type === "flat" ? "border-accent bg-accent-soft text-accent" : "border-transparent hover:bg-hover",
                )}
              >
                <Link
                  href={href}
                  title={m.label}
                  onClick={() => m.type === "accordion" && !open[m.key] && toggleModule(m.key)}
                  className={clsx(
                    "flex min-w-0 flex-1 items-center gap-3 px-3 text-sm font-medium",
                    isActiveModule ? "text-accent" : "text-fg-secondary",
                  )}
                >
                  <Icon name={m.icon} />
                  <span className={clsx("truncate", collapsed ? "hidden" : "hidden lg:inline")}>{m.label}</span>
                </Link>
                {m.type === "accordion" && !collapsed && (
                  <span className="hidden min-w-5 rounded-full bg-hover px-1.5 text-center text-xs font-semibold text-fg-secondary lg:inline" title={`${m.categories.reduce((n, c) => n + c.functions.length, 0)} chức năng`}>
                    {m.categories.reduce((n, c) => n + c.functions.length, 0)}
                  </span>
                )}
                {m.type === "accordion" && !collapsed && (
                  <button
                    type="button"
                    aria-label={`${expanded ? "Thu gọn" : "Mở rộng"} ${m.label}`}
                    aria-expanded={!!expanded}
                    onClick={() => toggleModule(m.key)}
                    className="hidden h-8 w-8 items-center justify-center text-fg-muted hover:text-fg lg:flex"
                  >
                    <ChevronDown size={16} className={clsx("transition-transform", expanded && "rotate-180")} aria-hidden />
                  </button>
                )}
              </div>

              {expanded && (
                <div className="ml-5 hidden border-l border-border pb-1 pl-1.5 lg:block">
                  {m.categories.map((c) => (
                    <div key={c.key} className="mt-1">
                      {!c.hideTitle && (
                        <div className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">
                          {c.label}
                        </div>
                      )}
                      {c.functions.map((f) => {
                        const on = active?.fn.key === f.key;
                        return (
                          <Link
                            key={f.key}
                            href={f.path}
                            aria-current={on ? "page" : undefined}
                            className={clsx(
                              "relative flex h-9 items-center gap-3 truncate rounded-sm px-3 text-sm",
                              on ? "bg-accent-soft font-medium text-accent before:absolute before:-left-[8px] before:inset-y-2 before:w-[3px] before:rounded before:bg-accent" : "text-fg-secondary hover:bg-hover",
                            )}
                          >
                            <Icon name={f.icon} size={16} />
                            <span className="truncate">{f.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
