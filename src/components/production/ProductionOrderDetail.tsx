"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DetailField, DetailPage, ReasonDialog, useDetailNav } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDate, formatDateTime, formatQty } from "@/lib/format";
import type { ProductionDetailDTO } from "@/server/production/queries";

export function ProductionOrderDetail({ order }: { order: ProductionDetailDTO }) {
  const router = useRouter(), nav = useDetailNav(["info", "outputs", "lines"]), [open, setOpen] = useState(false);
  const showCost = order.unitCost !== undefined, multi = (order.outputs?.length ?? 0) > 1;
  const outputs = order.outputs ?? [];
  const totalWeight = outputs.reduce((sum, o) => sum + Number(o.allocationWeight), 0);
  async function cancel(reason: string) { await apiFetch(`/api/production/orders/${order.id}/cancel`, { method: "POST", json: { reason } }); router.refresh(); }
  return <div className="space-y-4">
    {order.isCancelled && <div role="status" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">Lệnh đã hủy. Lý do: {order.cancelReason}.</div>}
    <DetailPage backHref="/production/orders" backLabel="Quay lại lệnh sản xuất"
      headerActions={!order.isCancelled ? <button type="button" onClick={() => setOpen(true)} className="h-11 rounded-sm border border-danger px-3 text-sm font-medium text-danger">Hủy lệnh</button> : undefined}
      summary={{ title: order.code, code: multi ? `${outputs.length} sản phẩm đầu ra` : `${order.productCode} — ${order.productName}`, badges: [{ label: order.isCancelled ? "Đã hủy" : "Hiệu lực", tone: order.isCancelled ? "danger" : "success" }], facts: [{ label: "Ngày", value: formatDate(order.at) }, { label: multi ? "Sản phẩm đầu ra" : "Số lượng", value: multi ? String(outputs.length) : `${formatQty(order.qty)} ${order.baseUnit}` }, ...(showCost && !multi ? [{ label: "Giá thành/đv", value: order.unitCost ? formatCurrency(order.unitCost) : "—" }] : []), { label: "Người lập", value: order.createdByName ?? "—" }] }}
      tabs={[
        { key: "info", label: "Thông tin chung", render: () => <dl className="grid gap-x-8 gap-y-2 md:grid-cols-2"><DetailField label="Ghi chú">{order.note}</DetailField><DetailField label="Thời điểm ghi sổ">{formatDateTime(order.at)}</DetailField>{showCost && <DetailField label="Tổng giá thành đầu ra">{order.totalCost ? formatCurrency(order.totalCost) : "—"}</DetailField>}</dl> },
        { key: "outputs", label: "Sản phẩm đầu ra", count: outputs.length, render: () => <div className="space-y-3">
          <p className="text-sm text-fg-secondary">Phân bổ giá vốn: {order.allocationBasis === "AREA" ? "Theo diện tích xẻ khổ" : "Theo trọng số"}.</p>
          {order.allocationBasis === "AREA" && <p className="text-sm tabular">Nguyên liệu: {formatQty(order.inputLengthM ?? "0")} m × khổ {formatQty(order.inputWidthMm ?? "0")} mm. Khổ còn lại / hao hụt: {formatQty(Number(order.inputWidthMm ?? 0) - outputs.reduce((sum, o) => sum + Number(o.widthMm ?? 0) * o.stripCount, 0))} mm.</p>}
          <div className="overflow-x-auto rounded-sm border border-border"><table className="line-table w-full text-sm">
            <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="p-3">Sản phẩm</th><th className="p-3 text-right">Số lượng</th><th className="p-3 text-right">Quy cách xẻ</th><th className="p-3 text-right">Phân bổ</th>{showCost && <><th className="p-3 text-right">Giá thành/đv</th><th className="p-3 text-right">Thành tiền</th></>}</tr></thead>
            <tbody>{outputs.map(o => <tr key={o.id} className="border-t border-border">
              <td className="p-3" data-label="Sản phẩm" data-wide>{o.productCode} — {o.productName}</td><td className="p-3 text-right tabular" data-label="Số lượng">{formatQty(o.qty)} {o.baseUnit}</td>
              <td className="p-3 text-right tabular" data-label="Quy cách xẻ">{o.widthMm ? `${o.stripCount} dải × ${formatQty(o.lengthM ?? "0")} m × ${formatQty(o.widthMm)} mm` : "—"}</td><td className="p-3 text-right tabular" data-label="Phân bổ">{formatQty(totalWeight ? Number(o.allocationWeight) / totalWeight * 100 : 0)}%</td>
              {showCost && <><td className="p-3 text-right tabular" data-label="Giá thành/đv">{o.unitCost ? formatCurrency(o.unitCost) : "—"}</td><td className="p-3 text-right tabular" data-label="Thành tiền">{o.totalCost ? formatCurrency(o.totalCost) : "—"}</td></>}
            </tr>)}</tbody>
          </table></div>
        </div> },
        { key: "lines", label: "Nguyên vật liệu", count: order.materials.length, render: () => <div className="overflow-x-auto rounded-sm border border-border"><table className="line-table w-full text-sm">
          <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="p-3">Nguyên vật liệu</th><th className="p-3 text-right">Số lượng</th>{showCost && <th className="p-3 text-right">Giá vốn</th>}</tr></thead>
          <tbody>{order.materials.map(m => <tr key={m.id} className="border-t border-border"><td className="p-3" data-label="Nguyên vật liệu" data-wide>{m.productCode} — {m.productName}</td><td className="p-3 text-right tabular" data-label="Số lượng">{formatQty(m.qty)} {m.baseUnit}</td>{showCost && <td className="p-3 text-right tabular" data-label="Giá vốn">{m.unitCost ? formatCurrency(m.unitCost) : "—"}</td>}</tr>)}</tbody>
        </table></div> },
      ]} {...nav} />
    <ReasonDialog open={open} onClose={() => setOpen(false)} title={`Hủy lệnh ${order.code}?`} description="Nguyên vật liệu được hoàn lại kho, tất cả sản phẩm đầu ra bị gỡ. Không hủy được nếu bất kỳ đầu ra nào đã bán hoặc sử dụng." confirmLabel="Hủy lệnh" onConfirm={cancel} />
  </div>;
}