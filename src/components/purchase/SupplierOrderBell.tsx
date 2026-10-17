"use client";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
export function SupplierOrderBell() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => { void apiFetch<unknown[]>("/api/supplier-orders/notices").then(rows => { if (active) setCount(rows.length); }).catch(() => {}); };
    refresh(); const timer = setInterval(refresh, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <Link href="/purchase/supplier-orders" title="Thông báo hàng đã về" aria-label={`Thông báo hàng đã về: ${count} chưa đọc`} className="relative flex h-11 w-11 items-center justify-center rounded-sm text-fg-secondary hover:bg-hover"><Bell size={18} />{count > 0 && <span className="absolute right-0 top-0 rounded-full bg-danger px-1 text-xs text-fg-on-accent">{count >= 20 ? "20+" : count}</span>}</Link>;
}
