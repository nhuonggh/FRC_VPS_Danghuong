"use client";

import clsx from "clsx";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavModule } from "@/config/app.config";
import { findActiveFunction } from "@/lib/nav";
import { APP_NAME } from "@/lib/version";
import { Icon } from "./icons";

const OPEN_KEY = "nav-open"; // trạng thái mở accordion: persist theo PHIÊN (sessionStorage)
const COLLAPSE_KEY = "sidebar-collapsed";

export function Sidebar({ nav }: { nav: NavModule[] }) {
  const pathname = usePathname();
  const active = findActiveFunction(nav, pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
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

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* bỏ qua */ }
      return !c;
    });

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
        {nav.map((m) => {
          const isActiveModule = active?.module.key === m.key || (m.type === "flat" && pathname === m.path);
          const expanded = !collapsed && m.type === "accordion" && open[m.key];
          const href = m.type === "flat" ? m.path! : `/m/${m.key}`;
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
                <div className="hidden pb-1 lg:block">
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
                              "ml-8 flex h-9 items-center gap-2 truncate rounded-sm border-l-[3px] px-3 text-sm",
                              on ? "border-accent bg-accent-soft font-medium text-accent" : "border-transparent text-fg-secondary hover:bg-hover",
                            )}
                          >
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
