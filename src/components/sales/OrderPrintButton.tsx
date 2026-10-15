"use client";
import { Printer } from "lucide-react";
export function OrderPrintButton() {
  return <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-border px-3 text-sm print:hidden"><Printer size={16} aria-hidden />In danh sách</button>;
}
