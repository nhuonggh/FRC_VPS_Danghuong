"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PrintButton } from "@/components/print/PrintButton";
import { DetailField, DetailPage, useDetailNav } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { formatCurrency, formatDate, formatQty } from "@/lib/format";
import type { QuoteDetailDTO } from "@/server/quotes/queries";

export const QUOTE_STATUS = {
  DRAFT: { label: "Nháp", tone: "neutral" as const },
  SENT: { label: "Đã gửi khách", tone: "info" as const },
  CONVERTED: { label: "Đã chuyển thành đơn", tone: "success" as const },
  CANCELLED: { label: "Đã hủy", tone: "danger" as const },
};

export function QuoteDetail({ quote, canManage, canConvert, canPrint = false }: { quote: QuoteDetailDTO; canManage: boolean; canConvert: boolean; canPrint?: boolean }) {
  const router = useRouter();
  const nav = useDetailNav(["info", "lines"]);
  const [busy, setBusy] = useState(false);
  const open = quote.status === "DRAFT" || quote.status === "SENT";
  const showPrice = quote.quoteTotal !== undefined;

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try { await fn(); router.refresh(); } finally { setBusy(false); }
  }
  const send = () => run(() => apiFetch(`/api/quotes/${quote.id}/status`, { method: "POST", json: { status: "SENT" } }));
  async function cancel() {
    const ok = await confirm({ title: `Hủy báo giá ${quote.code}?`, description: "Báo giá đã hủy không sửa hay chuyển thành đơn được nữa.", confirmLabel: "Hủy báo giá", danger: true });
    if (ok) await run(() => apiFetch(`/api/quotes/${quote.id}/status`, { method: "POST", json: { status: "CANCELLED" } }));
  }
  async function convert() {
    const ok = await confirm({ title: `Chuyển ${quote.code} thành đơn?`, description: "Tạo ĐƠN NHÁP với đúng dòng hàng và giá của báo giá. Chưa xuất kho — chỉ xuất kho khi bạn xác nhận đơn nháp.", confirmLabel: "Chuyển thành đơn" });
    if (!ok || busy) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ orderId: number }>(`/api/quotes/${quote.id}/convert`, { method: "POST" });
      router.push(`/sales/orders/${r.orderId}`);
    } finally { setBusy(false); }
  }

  const st = QUOTE_STATUS[quote.status];
  const actions = (
    <>
      {canPrint && quote.status !== "CANCELLED" && <PrintButton docType="QUOTE" docId={quote.id} label="In báo giá" />}
      {open && canManage && quote.status === "DRAFT" && <button type="button" onClick={send} disabled={busy} className="h-10 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover disabled:opacity-50">Đánh dấu đã gửi</button>}
      {open && canManage && <Link href={`/sales/quotes/${quote.id}/edit`} className="flex h-10 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover">Sửa</Link>}
      {open && canManage && <button type="button" onClick={cancel} disabled={busy} className="h-10 rounded-sm border border-danger px-3 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50">Hủy báo giá</button>}
      {open && canConvert && <button type="button" onClick={convert} disabled={busy} className="h-10 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50">Chuyển thành đơn</button>}
    </>
  );

  return (
    <DetailPage
      backHref="/sales/quotes" backLabel="Quay lại báo giá" headerActions={actions}
      summary={{
        title: quote.partnerName, code: quote.code, badges: [{ label: st.label, tone: st.tone }],
        facts: [{ label: "Ngày", value: formatDate(quote.at) }, { label: "Số dòng", value: quote.lines.length }, ...(showPrice ? [{ label: "Tổng", value: formatCurrency(quote.quoteTotal!) }] : [])],
      }}
      tabs={[
        {
          key: "info", label: "Thông tin",
          render: () => (
            <dl className="space-y-2">
              <DetailField label="Khách hàng">{quote.partnerCode} — {quote.partnerName}</DetailField>
              <DetailField label="Ngày báo giá">{formatDate(quote.at)}</DetailField>
              <DetailField label="Ghi chú">{quote.note}</DetailField>
              <DetailField label="Người lập">{quote.createdByName}</DetailField>
              <DetailField label="Đơn hàng">{quote.convertedOrder ? <Link href={`/sales/orders/${quote.convertedOrder.id}`} className="text-accent hover:underline">{quote.convertedOrder.code}</Link> : null}</DetailField>
            </dl>
          ),
        },
        {
          key: "lines", label: "Dòng hàng", count: quote.lines.length,
          render: () => (
            <div className="overflow-x-auto rounded-sm border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
                  <th className="px-3 py-2">Sản phẩm</th><th className="px-3 py-2 text-right">SL</th><th className="px-3 py-2">ĐVT</th>
                  {showPrice && <><th className="px-3 py-2 text-right">Đơn giá</th><th className="px-3 py-2 text-right">Thành tiền</th></>}<th className="px-3 py-2">Ghi chú</th>
                </tr></thead>
                <tbody>
                  {quote.lines.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="px-3 py-2"><strong>{l.productName}</strong><span className="block font-mono text-xs text-fg-muted">{l.productCode}</span></td>
                      <td className="px-3 py-2 text-right tabular">{formatQty(l.qty)}</td><td className="px-3 py-2">{l.unit}</td>
                      {showPrice && <><td className="px-3 py-2 text-right tabular">{l.salePrice !== undefined && formatCurrency(l.salePrice)}</td><td className="px-3 py-2 text-right tabular">{l.lineAmount !== undefined && formatCurrency(l.lineAmount)}</td></>}
                      <td className="px-3 py-2 text-fg-secondary">{l.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
      ]}
      {...nav}
    />
  );
}

