"use client";

import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { ArrowDown, ArrowUp, ChevronRight, RotateCcw, Search, Settings2, Star, X, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import type { NavModule } from "@/config/app.config";
import { normalizeSearch } from "@/lib/search";
import { allFunctions, isQuick, moveQuick, resetQuick, resolveQuick, toggleQuick } from "@/lib/workspace";
import { useWorkspace } from "@/lib/workspace-store";
import { GuardedLink } from "./GuardedLink";
import { Icon } from "./icons";

/**
 * Nút "Truy cập nhanh" cạnh công tắc sáng/tối: mở hộp thoại lưới thẻ chức năng hay dùng. Danh sách là "yêu thích toàn hệ thống" của
 * từng tài khoản (mặc định = bộ chức năng hay dùng); người dùng thêm/bỏ/sắp xếp ở chế độ Tùy chỉnh. Chỉ liệt kê chức năng có quyền.
 */
export function QuickAccess({ nav }: { nav: NavModule[] }) {
  const prefs = useWorkspace((s) => s.prefs);
  const update = useWorkspace((s) => s.update);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const items = useMemo(() => resolveQuick(nav, prefs), [nav, prefs]);
  const needle = normalizeSearch(q);
  const picker = useMemo(() => allFunctions(nav).filter(({ fn, module: m }) => !needle || normalizeSearch(`${fn.label} ${fn.desc} ${m.label}`).includes(needle)), [nav, needle]);
  const groups = useMemo(() => nav.filter((m) => picker.some((x) => x.module.key === m.key)), [nav, picker]);

  const close = () => { setOpen(false); setEditing(false); setQ(""); };
  const iconBtn = "flex size-9 items-center justify-center rounded-sm text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <Dialog.Root open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
      <Dialog.Trigger asChild>
        <button type="button" title="Truy cập nhanh" className="flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-sm font-semibold text-fg-on-accent shadow-sm hover:bg-accent-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <Zap size={16} aria-hidden /><span className="hidden sm:inline">Truy cập nhanh</span><span className="sr-only sm:hidden">Truy cập nhanh</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-dialog flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-raised shadow-lg">
          <div className="flex items-center gap-3 border-b border-border p-4">
            <span className="flex size-10 items-center justify-center rounded-md bg-accent-soft text-accent"><Zap size={20} aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold">Truy cập nhanh</Dialog.Title>
              <p className="text-sm text-fg-secondary">{editing ? "Chọn chức năng bạn muốn có ở đây" : "Mở nhanh chức năng bạn hay dùng"}</p>
            </div>
            <button type="button" onClick={() => setEditing((v) => !v)} aria-pressed={editing} className={clsx("flex h-9 items-center gap-2 rounded-sm border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", editing ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-hover")}>
              <Settings2 size={16} aria-hidden />{editing ? "Xong" : "Tùy chỉnh"}
            </button>
            <Dialog.Close className={iconBtn} aria-label="Đóng"><X size={18} aria-hidden /></Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            {items.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">Chưa có chức năng nào. Bấm “Tùy chỉnh” để thêm.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2" aria-label="Chức năng truy cập nhanh">
                {items.map(({ module: m, fn }, i) => (
                  <li key={fn.key} className="relative rounded-lg border border-border bg-surface">
                    <GuardedLink href={fn.path} onClick={close} className={clsx("flex min-h-16 items-center gap-3 rounded-lg p-3", editing ? "pointer-events-none pr-28" : "pr-10 hover:bg-hover")} aria-disabled={editing || undefined} tabIndex={editing ? -1 : undefined}>
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"><Icon name={fn.icon} size={20} /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{fn.label}</span><span className="block truncate text-xs text-fg-secondary">{fn.desc || m.label}</span></span>
                      {!editing && <ChevronRight size={16} className="text-fg-muted" aria-hidden />}
                    </GuardedLink>
                    {editing && (
                      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
                        <button type="button" className={iconBtn} aria-label={`Chuyển ${fn.label} lên`} disabled={i === 0} onClick={() => update((p) => moveQuick(p, fn.key, -1))}><ArrowUp size={16} aria-hidden /></button>
                        <button type="button" className={iconBtn} aria-label={`Chuyển ${fn.label} xuống`} disabled={i === items.length - 1} onClick={() => update((p) => moveQuick(p, fn.key, 1))}><ArrowDown size={16} aria-hidden /></button>
                        <button type="button" className={iconBtn} aria-label={`Bỏ yêu thích ${fn.label}`} aria-pressed onClick={() => update((p) => toggleQuick(p, fn.key))}><Star size={16} className="fill-current text-warning" aria-hidden /></button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {editing && (
              <section aria-label="Thêm chức năng" className="space-y-3 border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-sm font-semibold">Thêm chức năng</h3>
                  <label className="relative ml-auto w-full sm:w-64">
                    <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm chức năng…" aria-label="Tìm chức năng để thêm" className="h-9 w-full rounded-sm border border-border bg-canvas pl-9 pr-3 text-sm" />
                  </label>
                </div>
                {groups.map((m) => (
                  <div key={m.key}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">{m.label}</p>
                    <ul className="grid gap-1 sm:grid-cols-2">
                      {picker.filter((x) => x.module.key === m.key).map(({ fn }) => {
                        const on = isQuick(prefs, fn.key);
                        return (
                          <li key={fn.key}>
                            <button type="button" aria-pressed={on} aria-label={on ? `Bỏ yêu thích ${fn.label} (${m.label})` : `Thêm ${fn.label} (${m.label}) vào yêu thích`} onClick={() => update((p) => toggleQuick(p, fn.key))} className="flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:min-h-9">
                              <Star size={16} className={on ? "fill-current text-warning" : "text-fg-muted"} aria-hidden /><span className="truncate">{fn.label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                {groups.length === 0 && <p className="text-sm text-fg-muted">Không tìm thấy chức năng phù hợp.</p>}
                <button type="button" onClick={() => update(resetQuick)} className="flex h-9 items-center gap-2 rounded-sm border border-border px-3 text-sm hover:bg-hover"><RotateCcw size={14} aria-hidden />Khôi phục mặc định</button>
              </section>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
