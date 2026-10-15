"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api-fetch";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui";
import type { ReviewState } from "@/server/home/daily-review";

export function DailyReviewBadge({ state }: { state: ReviewState }) {
  const labels = { unseen: "Chưa xem", seen: "Đã xem", checked: "Đã kiểm tra", changed: "Có cập nhật · cần xem lại" };
  const tones = { unseen: "neutral", seen: "info", checked: "success", changed: "warning" } as const;
  return <Badge tone={tones[state.status]}>{labels[state.status]}</Badge>;
}

export function DailyReviewControl({ day, itemKey, version, initial }: { day: string; itemKey: string; version: string; initial: ReviewState }) {
  const router = useRouter();
  const [state, setState] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setState(initial); setError(""); setBusy(false);
    if (initial.status === "checked" || initial.status === "seen") return;
    setBusy(true);
    apiFetch<ReviewState>("/api/home/daily/review", { method: "POST", json: { day, itemKey, action: "seen", expectedVersion: version } }).then((next) => {
      if (active) { setState(next); router.refresh(); }
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "Chưa lưu được trạng thái đã xem."); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [day, itemKey, version, initial, retry, router]);

  async function toggle() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const next = await apiFetch<ReviewState>("/api/home/daily/review", { method: "POST", json: { day, itemKey, action: state.status === "checked" ? "uncheck" : "check", expectedVersion: version } });
      setState(next); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Chưa lưu được xác nhận."); if (e instanceof ApiError && e.status === 409) router.refresh(); }
    finally { setBusy(false); }
  }
  return <section aria-label="Tiến độ kiểm tra của tôi" className="space-y-2 rounded-md border border-border bg-surface p-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><DailyReviewBadge state={state} /><label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={state.status === "checked"} disabled={busy || state.status === "unseen" || state.status === "changed"} onChange={toggle} />{busy ? "Đang lưu…" : "Đã kiểm tra mục này"}</label></div>
    <p className="text-xs text-fg-secondary">{state.status === "checked" && state.checkedAt ? `Bạn đã xác nhận lúc ${formatDateTime(state.checkedAt)}.` : state.seenAt ? `Bạn đã xem lúc ${formatDateTime(state.seenAt)}. Tick sau khi đối chiếu xong.` : "Đang ghi nhận lần xem của bạn."} Có thể bỏ tick để kiểm tra lại.</p>
    {error && <div role="alert" className="text-sm text-danger">{error}<button type="button" disabled={busy} onClick={() => state.status === "unseen" || state.status === "changed" ? setRetry((n) => n + 1) : void toggle()} className="ml-2 min-h-11 text-accent underline">Thử lại</button></div>}
  </section>;
}
