"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DetailField, DetailPage, ReasonDialog, useDetailNav } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDate, formatQty } from "@/lib/format";
import type { ReturnDetailDTO } from "@/server/returns/queries";

export const RETURN_KIND_LABEL = { BY_ORDER: "Trả theo đơn", BY_PRODUCT: "Trả theo sản phẩm", SUPPLIER: "Trả nhà cung cấp" } as const;

export function ReturnDetail({ ret, canManage }: { ret: ReturnDetailDTO; canManage: boolean }) {
  const router = useRouter();
  const nav = useDetailNav(["info", "lines"]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const supplier = ret.kind === "SUPPLIER";
  const total = supplier ? ret.purchaseTotal : ret.returnTotal;
  const showPrice = total !== undefined;
  const backHref = supplier ? "/returns/to-supplier" : ret.kind === "BY_ORDER" ? "/returns/by-order" : "/returns/by-product";
  async function cancel(reason: string) { await apiFetch(`/api/returns/${ret.id}/cancel`, { method: "POST", json: { reason } }); router.refresh(); }

  const actions = !ret.isCancelled && canManage
    ? <button type="button" onClick={() => setCancelOpen(true)} className="h-10 rounded-sm border border-danger px-3 text-sm font-medium text-danger hover:bg-danger-soft">Hủy phiếu trả</button>
    : undefined;

  return (
    <div className="space-y-4">
      {ret.isCancelled && (
        <div role="status" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">Phiếu trả đã hủy{ret.cancelReason ? `. Lý do: ${ret.cancelReason}` : ""}.</div>
      )}
      <DetailPage
        backHref={backHref} backLabel="Quay lại danh sách trả hàng" headerActions={actions}
        summary={{
          title: ret.partnerName, code: ret.code,
          badges: [{ label: RETURN_KIND_LABEL[ret.kind], tone: "info" as const }, ...(ret.isCancelled ? [{ label: "Đã hủy", tone: "danger" as const }] : [])],
          facts: [{ label: "Ngày", value: formatDate(ret.at) }, { label: "Số dòng", value: ret.lines.length }, ...(showPrice ? [{ label: supplier ? "Giảm công nợ phải trả" : "Trừ công nợ", value: formatCurrency(total!) }] : [])],
        }}
        tabs={[
          {
            key: "info", label: "Thông tin cơ bản",
            render: () => (
              <dl className="grid gap-x-8 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
                <DetailField label={supplier ? "Nhà cung cấp" : "Khách hàng"}>{ret.partnerCode} — {ret.partnerName}</DetailField>
                <DetailField label="Ngày trả">{formatDate(ret.at)}</DetailField>
                <DetailField label="Đơn hàng gốc">{ret.orderId ? <Link href={`/sales/orders/${ret.orderId}`} className="text-accent hover:underline">{ret.orderCode}</Link> : null}</DetailField>
                <DetailField label="Ghi chú">{ret.note}</DetailField>
                {ret.returnDeduction !== undefined && Number(ret.returnDeduction) > 0 && <DetailField label="Khấu trừ">{formatCurrency(ret.returnDeduction)}{ret.deductionNote ? ` — ${ret.deductionNote}` : ""}</DetailField>}
                {(ret.refunds ?? []).length > 0 && <DetailField label="Đã hoàn tiền khách">{(ret.refunds ?? []).map((p) => <span key={p.id} className={`block ${p.isCancelled ? "text-fg-muted line-through" : ""}`}><Link href={`/accounting/payments/${p.id}`} className="font-mono text-xs text-accent hover:underline">{p.code}</Link> · {p.refundAmount !== undefined && formatCurrency(p.refundAmount)} · {p.accountName}</span>)}</DetailField>}
                <DetailField label="Người lập">{ret.createdByName}</DetailField>
              </dl>
            ),
          },
          {
            key: "lines", label: "Dòng hàng", count: ret.lines.length,
            render: () => (
              <div className="overflow-x-auto rounded-sm border border-border">
                <table className="w-full min-w-[520px] text-sm">
                  <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
                    <th className="px-3 py-2">Sản phẩm</th><th className="px-3 py-2 text-right">SL</th><th className="px-3 py-2">ĐVT</th>
                    {showPrice && <><th className="px-3 py-2 text-right">Đơn giá</th><th className="px-3 py-2 text-right">Thành tiền</th></>}
                  </tr></thead>
                  <tbody>
                    {ret.lines.map((l) => {
                      const price = l.salePrice ?? l.purchasePrice, amount = l.lineAmount ?? l.purchaseAmount;
                      return (
                        <tr key={l.id} className="border-t border-border">
                          <td className="px-3 py-2"><strong>{l.productName}</strong><span className="block font-mono text-xs text-fg-muted">{l.productCode}</span>{l.note && <span className="block text-xs text-fg-secondary">{l.note}</span>}</td>
                          <td className="px-3 py-2 text-right tabular">{formatQty(l.qty)}</td><td className="px-3 py-2">{l.unit}</td>
                          {showPrice && <><td className="px-3 py-2 text-right tabular">{price !== undefined && formatCurrency(price)}</td><td className="px-3 py-2 text-right tabular">{amount !== undefined && formatCurrency(amount)}</td></>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ),
          },
        ]}
        {...nav}
      />
      <ReasonDialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={`Hủy phiếu trả ${ret.code}?`}
        description={supplier ? "Hàng được nhập lại kho và công nợ phải trả trở về như trước." : "Hàng trả bị gỡ khỏi kho, công nợ khách và chiết khấu tích lũy trở về như trước."} confirmLabel="Hủy phiếu trả" onConfirm={cancel} />
    </div>
  );
}
