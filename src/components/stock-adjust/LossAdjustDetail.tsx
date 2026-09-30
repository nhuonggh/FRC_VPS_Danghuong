"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DetailField, DetailPage, ReasonDialog, useDetailNav } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDate, formatQty } from "@/lib/format";
import { LOSS_TYPE_LABEL } from "@/server/stock-adjust/schemas";
import type { LossDetailDTO } from "@/server/stock-adjust/service";

export function LossAdjustDetail({ adj }: { adj: LossDetailDTO }) {
  const router = useRouter(), nav = useDetailNav(["info"]), [open, setOpen] = useState(false);
  const showCost = adj.lines.some((l) => l.cost !== undefined);
  async function cancel(reason: string) { await apiFetch(`/api/stock-adjustments-loss/${adj.id}/cancel`, { method: "POST", json: { reason } }); router.refresh(); }
  return (
    <div className="space-y-4">
      {adj.isCancelled && <div role="status" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">Phiếu đã hủy. Lý do: {adj.cancelReason}.</div>}
      <DetailPage
        backHref="/inventory/adjustments" backLabel="Quay lại điều chỉnh hao hụt"
        headerActions={!adj.isCancelled ? <button type="button" onClick={() => setOpen(true)} className="h-10 rounded-sm border border-danger px-3 text-sm font-medium text-danger">Hủy phiếu</button> : undefined}
        summary={{ title: adj.code, code: LOSS_TYPE_LABEL[adj.type], badges: [{ label: adj.isCancelled ? "Đã hủy" : "Hiệu lực", tone: adj.isCancelled ? "danger" : "success" }], facts: [{ label: "Ngày", value: formatDate(adj.at) }, { label: "Số dòng", value: adj.lines.length }, { label: "Người lập", value: adj.createdByName ?? "—" }] }}
        tabs={[{ key: "info", label: "Chi tiết", render: () => (
          <div className="space-y-5">
            <dl><DetailField label="Lý do">{adj.note}</DetailField></dl>
            <div className="overflow-x-auto rounded-sm border border-border">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Sản phẩm</th><th className="px-3 py-2 text-right">Số lượng</th>{showCost && <th className="px-3 py-2 text-right">Giá vốn</th>}</tr></thead>
                <tbody>{adj.lines.map((l) => <tr key={l.id} className="border-t border-border"><td className="px-3 py-2"><span className="font-mono text-xs">{l.productCode}</span> {l.productName}</td><td className="px-3 py-2 text-right tabular">{formatQty(l.qty)} {l.baseUnit}</td>{showCost && <td className="px-3 py-2 text-right tabular">{l.cost ? formatCurrency(l.cost) : "—"}</td>}</tr>)}</tbody>
              </table>
            </div>
          </div>
        ) }]}
        {...nav}
      />
      <ReasonDialog open={open} onClose={() => setOpen(false)} title={`Hủy phiếu ${adj.code}?`} description="Hàng đã trừ sẽ được hoàn lại kho." confirmLabel="Hủy phiếu" onConfirm={cancel} />
    </div>
  );
}
