"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DetailField, DetailPage, ReasonDialog, useDetailNav } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDate, formatDateTime, formatQty } from "@/lib/format";
import type { ProductionDetailDTO } from "@/server/production/queries";

export function ProductionOrderDetail({ order }: { order: ProductionDetailDTO }) {
  const router = useRouter(), nav = useDetailNav(["info", "lines"]), [open, setOpen] = useState(false);
  const showCost = order.unitCost !== undefined;
  async function cancel(reason: string) { await apiFetch(`/api/production/orders/${order.id}/cancel`, { method: "POST", json: { reason } }); router.refresh(); }
  return (
    <div className="space-y-4">
      {order.isCancelled && <div role="status" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">Lệnh đã hủy. Lý do: {order.cancelReason}.</div>}
      <DetailPage
        backHref="/production/orders" backLabel="Quay lại lệnh sản xuất"
        headerActions={!order.isCancelled ? <button type="button" onClick={() => setOpen(true)} className="h-10 rounded-sm border border-danger px-3 text-sm font-medium text-danger">Hủy lệnh</button> : undefined}
        summary={{ title: order.code, code: `${order.productCode} — ${order.productName}`, badges: [{ label: order.isCancelled ? "Đã hủy" : "Hiệu lực", tone: order.isCancelled ? "danger" : "success" }], facts: [{ label: "Ngày", value: formatDate(order.at) }, { label: "Số lượng", value: `${formatQty(order.qty)} ${order.baseUnit}` }, ...(showCost ? [{ label: "Giá thành/đv", value: order.unitCost ? formatCurrency(order.unitCost) : "—" }] : []), { label: "Người lập", value: order.createdByName ?? "—" }] }}
        tabs={[{ key: "info", label: "Thông tin chung", render: () => (
          <div className="space-y-5">
            <dl className="grid gap-x-8 gap-y-2 md:grid-cols-2"><DetailField label="Ghi chú">{order.note}</DetailField><DetailField label="Thời điểm ghi sổ">{formatDateTime(order.at)}</DetailField>{showCost && <DetailField label="Tổng vốn nguyên vật liệu">{order.totalCost ? formatCurrency(order.totalCost) : "—"}</DetailField>}</dl>
          </div>
        ) }, { key: "lines", label: "Nguyên vật liệu", count: order.materials.length, render: () => (
          <div className="space-y-5">
            <div className="overflow-x-auto rounded-sm border border-border">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Nguyên vật liệu</th><th className="px-3 py-2 text-right">Số lượng</th>{showCost && <th className="px-3 py-2 text-right">Giá vốn</th>}</tr></thead>
                <tbody>{order.materials.map((m) => <tr key={m.id} className="border-t border-border"><td className="px-3 py-2"><span className="font-mono text-xs">{m.productCode}</span> {m.productName}</td><td className="px-3 py-2 text-right tabular">{formatQty(m.qty)} {m.baseUnit}</td>{showCost && <td className="px-3 py-2 text-right tabular">{m.unitCost ? formatCurrency(m.unitCost) : "—"}</td>}</tr>)}</tbody>
              </table>
            </div>
          </div>
        ) }]}
        {...nav}
      />
      <ReasonDialog open={open} onClose={() => setOpen(false)} title={`Hủy lệnh ${order.code}?`} description="Nguyên vật liệu được hoàn lại kho, phụ kiện Tôn thành phẩm bị gỡ. Không hủy được nếu phụ kiện Tôn đã bán." confirmLabel="Hủy lệnh" onConfirm={cancel} />
    </div>
  );
}
