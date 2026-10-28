"use client";
import { Printer } from "lucide-react";
export function OrderPrintButton({ label = "In danh sách" }: { label?: string }) {
  return <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-sm border border-border px-3 text-sm print:hidden"><Printer size={16} aria-hidden />{label}</button>;
}
