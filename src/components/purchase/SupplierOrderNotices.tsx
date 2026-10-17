"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { formatDateTime } from "@/lib/format";
type Notice = { id: number; orderId: number; message: string; createdAt: string };
export function SupplierOrderNotices() {
  const [rows, setRows] = useState<Notice[]>([]), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; const refresh = () => { void apiFetch<Notice[]>("/api/supplier-orders/notices").then(r => { if (active) setRows(r); }).catch(() => {}); }; refresh(); const timer = setInterval(refresh, 30000); return () => { active = false; clearInterval(timer); }; }, []);
  if (!rows.length) return null;
  return <section aria-label="Thông báo nhận hàng" className="space-y-2 rounded-sm border border-info bg-info-soft p-3"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Hàng bạn đặt đã về</h2><button disabled={busy} className="min-h-11 px-3 text-sm text-accent disabled:opacity-50" onClick={async () => { setBusy(true); try { await apiFetch("/api/supplier-orders/notices", { method: "POST" }); setRows([]); } finally { setBusy(false); } }}>Đánh dấu đã đọc</button></div>{rows.map(r => <Link key={r.id} href={`/purchase/supplier-orders/${r.orderId}`} className="block min-h-11 text-sm text-accent">{r.message}<span className="ml-2 text-xs text-fg-secondary">{formatDateTime(r.createdAt)}</span></Link>)}</section>;
}
