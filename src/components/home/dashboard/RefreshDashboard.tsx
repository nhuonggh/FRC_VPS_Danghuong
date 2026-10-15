"use client";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RefreshDashboard() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <button type="button" aria-label="Cập nhật số liệu" title="Cập nhật số liệu" disabled={pending} onClick={() => start(() => router.refresh())} className="flex h-11 w-11 items-center justify-center rounded-sm border border-border bg-surface hover:bg-hover focus-visible:outline focus-visible:outline-accent disabled:opacity-50"><RefreshCw size={16} aria-hidden className={pending ? "motion-safe:animate-spin" : undefined} /></button>;
}
