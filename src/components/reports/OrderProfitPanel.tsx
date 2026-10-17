"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { formatCurrency, formatDate, formatPercent, formatQty } from "@/lib/format";
import type { ReportResult } from "@/server/reports/types";

export function OrderProfitPanel({ detail, closeHref }: { detail: NonNullable<ReportResult["orderDetail"]> | null; closeHref: string }) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") router.push(closeHref); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [closeHref, detail?.id, router]);
  return <aside aria-label="Chi tiết lãi lỗ đơn hàng" className="fixed inset-0 z-sheet flex flex-col overflow-hidden bg-surface md:static md:z-auto md:rounded-md md:border md:border-border xl:w-96 xl:shrink-0">
    <header className="flex items-start justify-between gap-3 border-b border-border p-4">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">Chi tiết lãi lỗ</p><h2 ref={heading} tabIndex={-1} className="mt-1 text-xl font-semibold">{detail?.code ?? "Không tìm thấy đơn"}</h2>{detail && <p className="mt-1 text-sm text-fg-secondary">{detail.customer} · {formatDate(detail.date)}</p>}</div>
      <Link href={closeHref} aria-label="Đóng chi tiết lãi lỗ" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm hover:bg-hover"><X size={20} aria-hidden /></Link>
    </header>
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      {!detail ? <p className="text-sm text-fg-secondary">Đơn hàng không tồn tại hoặc không thuộc phạm vi được xem.</p> : <>
        <dl className="space-y-3 rounded-md border border-border bg-canvas p-4">{[{ key: "revenue", label: "Doanh thu sau CK trừ ngay" }, { key: "accum", label: "Chiết khấu tích lũy" }, { key: "cost", label: "Giá vốn FIFO" }, { key: "profit", label: "Lãi / lỗ" }].map((field) => <div key={field.key} className="flex justify-between gap-3 text-sm"><dt className="text-fg-secondary">{field.label}</dt><dd className={`text-right font-semibold tabular-nums ${field.key === "profit" ? Number(detail.figures.profit) < 0 ? "text-danger" : "text-success" : ""}`}>{formatCurrency(detail.figures[field.key])}</dd></div>)}<div className="flex justify-between gap-3 text-sm"><dt className="text-fg-secondary">Tỷ suất lãi / doanh thu</dt><dd className="tabular-nums">{formatPercent(detail.figures.margin)}</dd></div></dl>
        <p className="text-xs text-fg-secondary">Lãi = doanh thu sau CK trừ ngay − CK tích lũy − giá vốn FIFO. Chưa tính hàng trả và CK chuyển vào lãi công ty.</p>
        {detail.figures.note && <p role="status" className="rounded-sm bg-warning-soft p-3 text-sm text-warning">{detail.figures.note}</p>}
        <section aria-label="Lãi lỗ từng mặt hàng"><h3 className="mb-3 text-sm font-semibold">Chi tiết mặt hàng ({detail.lines.length})</h3><ul className="space-y-3">{detail.lines.map((line) => <li key={line.id} className="space-y-2 rounded-md border border-border p-3"><p className="text-sm font-semibold">{line.code} — {line.name}</p><p className="text-xs text-fg-secondary">{formatQty(line.qty)} {line.unit} × {formatCurrency(line.price)}</p><dl className="space-y-2 text-sm">{[{ key: "discountNow", label: "CK trừ ngay" }, { key: "revenue", label: "Doanh thu" }, { key: "accum", label: "CK tích lũy" }, { key: "cost", label: "Giá vốn" }, { key: "profit", label: "Lãi / lỗ" }].map((field) => <div key={field.key} className="flex justify-between gap-3"><dt className="text-fg-secondary">{field.label}</dt><dd className={`text-right tabular-nums ${field.key === "profit" && Number(line.profit) < 0 ? "text-danger" : ""}`}>{formatCurrency(line[field.key])}</dd></div>)}</dl>{line.note && <p className="text-xs text-warning">{line.note}</p>}</li>)}</ul></section>
      </>}
    </div>
    <footer className="border-t border-border p-4"><Link href={closeHref} className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-sm hover:bg-hover">Quay lại danh sách</Link></footer>
  </aside>;
}
