"use client";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { usePoll } from "@/lib/use-poll";
export function SupplierOrderBell() {
  const [count, setCount] = useState(0);
  usePoll(() => { void apiFetch<unknown[]>("/api/supplier-orders/notices").then(rows => setCount(rows.length)).catch(() => {}); });
  return <Link href="/purchase/supplier-orders" title="Thông báo hàng đã về" aria-label={`Thông báo hàng đã về: ${count} chưa đọc`} className="relative flex h-11 w-11 items-center justify-center rounded-sm text-fg-secondary hover:bg-hover"><Bell size={18} />{count > 0 && <span className="absolute right-0 top-0 rounded-full bg-danger px-1 text-xs text-fg-on-accent">{count >= 20 ? "20+" : count}</span>}</Link>;
}
