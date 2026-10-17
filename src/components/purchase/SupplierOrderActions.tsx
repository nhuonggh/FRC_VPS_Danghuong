"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, PackageCheck, Ban, Lock, CalendarCheck } from "lucide-react";
import { ReasonDialog, igInput } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
export function SupplierOrderActions({ id, state, canEdit, canReceive, lines }: { id: number; state: string; canEdit: boolean; canReceive: boolean; lines: { id: number; label: string; expectedDate: string }[] }) {
  const router = useRouter(), [busy, setBusy] = useState(false), [error, setError] = useState(""), [reason, setReason] = useState<"cancel" | "close" | null>(null), [dates, setDates] = useState(lines);
  async function act(action: string, reason = "") {
    setBusy(true); setError("");
    try { await apiFetch(`/api/supplier-orders/${id}`, { method: "POST", json: { action, reason, dates: dates.map(l => ({ lineId: l.id, expectedDate: l.expectedDate || null })) } }); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Không thực hiện được."); throw e; }
    finally { setBusy(false); }
  }
  const ended = ["RECEIVED", "CLOSED", "CANCELLED"].includes(state);
  const button = "flex h-11 w-11 items-center justify-center rounded-sm border border-border text-accent hover:bg-hover disabled:opacity-50";
  return <div className="space-y-3">{error && <p role="alert" className="text-danger">{error}</p>}<div className="flex gap-2">
    {canEdit && state === "DRAFT" && <button disabled={busy} title="Đã gửi nhà cung cấp" aria-label="Đã gửi nhà cung cấp" className={button} onClick={() => void act("send").catch(() => {})}><Send size={18} /></button>}
    {canReceive && ["SENT", "PARTIAL"].includes(state) && <Link title="Nhận hàng" aria-label="Nhận hàng" href={`/purchase/supplier-orders/${id}/receive`} className={button}><PackageCheck size={18} /></Link>}
    {canEdit && !ended && <><button title="Hủy đơn chưa nhận" aria-label="Hủy đơn chưa nhận" disabled={busy} className={button} onClick={() => setReason("cancel")}><Ban size={18} /></button><button title="Đóng phần còn thiếu" aria-label="Đóng phần còn thiếu" disabled={busy} className={button} onClick={() => setReason("close")}><Lock size={18} /></button></>}
  </div>{canEdit && !ended && <details className="rounded-sm border border-border p-3"><summary className="cursor-pointer text-sm">Cập nhật dự kiến giao hàng</summary><div className="mt-3 space-y-2">{dates.map((l, i) => <label key={l.id} className="grid items-center gap-2 text-sm md:grid-cols-2"><span>{l.label}</span><input type="date" value={l.expectedDate} className={igInput} onChange={e => setDates(current => current.map((v, k) => k === i ? { ...v, expectedDate: e.target.value } : v))} /></label>)}<button title="Lưu dự kiến giao" aria-label="Lưu dự kiến giao" disabled={busy} className={button} onClick={() => void act("schedule").catch(() => {})}><CalendarCheck size={18} /></button></div></details>}
    <ReasonDialog open={reason !== null} title={reason === "cancel" ? "Hủy đơn đặt hàng" : "Đóng phần chưa giao"} description="Ghi lý do để các kế toán cùng theo dõi." confirmLabel="Xác nhận" onClose={() => setReason(null)} onConfirm={async r => { await act(reason!, r); }} />
  </div>;
}
