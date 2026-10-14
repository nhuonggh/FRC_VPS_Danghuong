"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, DataTable, ReasonDialog, type Column, type RowAction } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatDateTime, formatQty } from "@/lib/format";
import type { UndeliveredRowDTO } from "@/server/trips/queries";

export function UndeliveredList({ rows, canManage, canReturn = false }: { rows: UndeliveredRowDTO[]; canManage: boolean; canReturn?: boolean }) {
  const router = useRouter();
  const [row, setRow] = useState<UndeliveredRowDTO | null>(null);
  const columns: Column<UndeliveredRowDTO>[] = [
    { key: "order", label: "Đơn", primaryOnMobile: true, render: (r) => <Link href={`/sales/orders/${r.orderId}`} className="font-mono text-xs text-accent hover:underline">{r.orderCode}</Link> },
    { key: "customer", label: "Khách hàng", render: (r) => <><span className="font-medium">{r.partnerName}</span><span className="block text-xs text-fg-secondary">{[r.phone, r.address].filter(Boolean).join(" · ")}</span></> },
    { key: "result", label: "Lần giao không thành công", render: (r) => <><Badge tone={r.result === "KHONG_GIAO" ? "danger" : "info"}>{r.resultLabel}</Badge><Link href={`/delivery/trips/${r.tripId}`} className="block text-xs text-accent hover:underline">{r.tripCode}</Link>{r.note && <span className="block text-xs text-fg-secondary">{r.note}</span>}{r.at && <span className="block text-xs text-fg-secondary">{formatDateTime(r.at)}</span>}</> },
    { key: "quantity", label: "Số lượng hiện tại của đơn", render: (r) => <div className="space-y-1 whitespace-normal text-sm"><p>Còn được giao: <strong className="tabular">{formatQty(r.remainingQty)}</strong></p><p className="text-fg-secondary">Đã trả kho (chưa giao): <span className="tabular">{formatQty(r.returnedQty)}</span></p></div> },
    { key: "state", label: "Tình trạng hiện tại", render: (r) => <div className="space-y-1 whitespace-normal">
      {Number(r.remainingQty) <= 0 ? <><Badge tone="success">{Number(r.returnedQty) > 0 ? "Đã giao/trả kho hết" : "Đã giao hết"}</Badge><p className="text-xs text-fg-secondary">Không còn hàng để xếp chuyến.</p></> : r.activeTripId ? <><Badge tone="info">Đã xếp chuyến giao lại</Badge><Link href={`/delivery/trips/${r.activeTripId}`} className="block text-xs text-accent">{r.activeTripCode}</Link></> : <><Badge tone="warning">{Number(r.returnedQty) > 0 ? "Đã trả kho một phần" : "Còn hàng chưa giao"}</Badge><p className="text-xs text-fg-secondary">Chỉ phần còn được giao xuất hiện ở Xếp chuyến.</p></>}
      {r.handledAt && <div className="text-xs text-fg-secondary"><span className="font-medium">Đã ghi nhận hướng xử lý</span><p>{r.handledNote}</p><p>{formatDateTime(r.handledAt)}</p><p>Ghi chú này không thay đổi kho hoặc đơn hàng.</p></div>}
    </div> },
  ];
  const actions = (r: UndeliveredRowDTO): RowAction[] => {
    if (!canManage || Number(r.remainingQty) <= 0) return [];
    return [
      ...(!r.activeTripId ? [{ key: "retry", label: "Xếp chuyến giao lại", icon: "truck" as const, href: `/delivery/trips/new?q=${encodeURIComponent(r.orderCode)}` }] : []),
      ...(canReturn && !r.activeTripId ? [{ key: "return", label: "Lập phiếu trả kho", icon: "warehouse" as const, href: `/returns/by-order/new?orderId=${r.orderId}&undelivered=1` }] : []),
      ...(!r.handledAt ? [{ key: "note", label: `Ghi nhận hướng xử lý ${r.orderCode}`, icon: "clipboard-check" as const, onClick: () => setRow(r) }] : []),
    ];
  };
  return <>
    <DataTable id="undelivered" rows={rows} columns={columns} rowKey={(r) => r.stopId} rowActions={actions} />
    <ReasonDialog open={row !== null} onClose={() => setRow(null)} title={row ? `Ghi nhận hướng xử lý ${row.orderCode}` : ""} description="Chỉ lưu ghi chú và chuyển mục này sang “Đã ghi nhận”. Không tự nhập kho, hủy đơn hoặc xếp chuyến. Nếu đơn vẫn còn số lượng được giao, đơn vẫn xuất hiện ở Xếp chuyến. Muốn trả kho, cần lập và lưu phiếu trả kho riêng." confirmLabel="Lưu ghi nhận"
      onConfirm={async (note) => { await apiFetch(`/api/trips/stops/${row!.stopId}/handle`, { method: "POST", json: { note } }); router.refresh(); }} />
  </>;
}
