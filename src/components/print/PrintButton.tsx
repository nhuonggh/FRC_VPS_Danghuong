import { Printer } from "lucide-react";
import { localPrintHref } from "@/lib/local-print";

/** Mọi phiếu mở trang HTML in trực tiếp ở tab mới (tự mở hộp thoại in). */
export function PrintButton({ docType, docId, label = "In", className, extra }: { docType: string; docId: number; label?: string; className?: string; extra?: string }) {
  return <a href={localPrintHref(docType, docId, extra)} target="_blank" rel="noopener noreferrer" className={className ?? "inline-flex min-h-11 items-center gap-2 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover focus-visible:outline-accent"}><Printer size={16} aria-hidden />{label}</a>;
}
