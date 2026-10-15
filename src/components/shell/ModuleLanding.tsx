"use client";

import Link from "next/link";
import { ArrowLeft, Search, Star } from "lucide-react";
import { useState } from "react";
import type { NavModule } from "@/config/app.config";
import { normalizeSearch } from "@/lib/search";
import { isPinned, togglePin } from "@/lib/workspace";
import { useWorkspace } from "@/lib/workspace-store";
import { GuardedLink } from "./GuardedLink";
import { Icon } from "./icons";

export function ModuleLanding({ module }: { module: NavModule }) {
  const [q, setQ] = useState("");
  const prefs = useWorkspace((s) => s.prefs);
  const update = useWorkspace((s) => s.update);
  const needle = normalizeSearch(q);
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/" className="flex h-10 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm hover:bg-hover">
          <ArrowLeft size={16} aria-hidden /> Trang chủ
        </Link>
        <h1 className="text-xl font-semibold">{module.label}</h1>
        <label className="relative ml-auto w-full sm:w-72">
          <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm chức năng…"
            aria-label="Tìm chức năng"
            className="h-10 w-full rounded-sm border border-border bg-canvas pl-9 pr-3 text-sm"
          />
        </label>
      </div>
      {module.categories.map((c) => {
        const fns = c.functions.filter((f) => !needle || normalizeSearch(f.label + " " + f.desc).includes(needle));
        if (fns.length === 0) return null;
        return (
          <section key={c.key} className="mb-8">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-accent">
              <span className="h-4 w-1 rounded-full bg-accent" aria-hidden />
              {c.label}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {fns.map((f) => {
                const pinned = isPinned(prefs, module.key, f.key);
                return (
                  // Hai hành động độc lập: bấm card = mở chức năng (tab tạm nếu chưa ghim); bấm ngôi sao = ghim/bỏ ghim.
                  <div key={f.key} className="relative rounded-md border border-border bg-surface transition-shadow hover:shadow-md">
                    <GuardedLink href={f.path} className="flex min-h-28 flex-col gap-2 rounded-md p-5 pr-12">
                      <span className="flex h-11 w-11 items-center justify-center rounded-md bg-accent-soft text-accent">
                        <Icon name={f.icon} size={22} />
                      </span>
                      <span className="text-base font-semibold">{f.label}</span>
                      {f.desc && <span className="line-clamp-2 text-sm text-fg-secondary">{f.desc}</span>}
                    </GuardedLink>
                    <button type="button" aria-pressed={pinned} aria-label={pinned ? `Bỏ yêu thích ${f.label}` : `Thêm ${f.label} vào yêu thích`} title={pinned ? "Bỏ yêu thích" : "Thêm vào yêu thích"}
                      onClick={() => update((p) => togglePin(p, module.key, f.key))}
                      className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-warning focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:size-8">
                      <Star size={18} className={pinned ? "fill-current text-warning" : ""} aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
