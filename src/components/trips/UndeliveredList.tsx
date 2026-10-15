"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, ReasonDialog } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatDateTime, formatQty } from "@/lib/format";
import type { UndeliveredRowDTO } from "@/server/trips/queries";

/** Hàng không giao được (42): giao cho người bán xử lý — giao lại (xếp chuyến mới), hủy đơn, hoặc trả về kho bằng “Trả theo đơn”. */
export function UndeliveredList({ rows, canManage }: { rows: UndeliveredRowDTO[]; canManage: boolean }) {
  const router = useRouter();
  const [row, setRow] = useState<UndeliveredRowDTO | null>(null);
  return (
    <>
      <table className="w-full min-w-[860px] text-sm">
        <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Đơn</th><th className="px-3 py-2">Khách</th><th className="px-3 py-2">Kết quả</th><th className="px-3 py-2 text-right">Còn phải giao</th><th className="px-3 py-2">Chuyến</th><th className="px-3 py-2">Xử lý</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.stopId} className="border-t border-border align-top">
              <td className="px-3 py-2 font-mono text-xs"><Link href={`/sales/orders/${r.orderId}`} className="text-accent hover:underline">{r.orderCode}</Link></td>
              <td className="px-3 py-2"><strong>{r.partnerName}</strong><span className="block text-xs text-fg-muted">{[r.phone, r.address].filter(Boolean).join(" · ")}</span></td>
              <td className="px-3 py-2"><Badge tone={r.result === "KHONG_GIAO" ? "danger" : "info"}>{r.resultLabel}</Badge>{r.note && <span className="block text-xs text-fg-muted">{r.note}</span>}{r.at && <span className="block text-xs text-fg-muted">{formatDateTime(r.at)}</span>}</td>
              <td className="px-3 py-2 text-right tabular">{formatQty(r.remainingQty)}</td>
              <td className="px-3 py-2"><Link href={`/delivery/trips/${r.tripId}`} className="font-mono text-xs text-accent hover:underline">{r.tripCode}</Link></td>
              <td className="px-3 py-2">
                {r.handledAt ? <span className="text-xs text-fg-secondary">Đã xử lý: {r.handledNote}</span> : canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Link href="/delivery/trips/new" className="flex h-9 items-center rounded-sm border border-border px-3 text-sm hover:bg-hover">Giao lại</Link>
                    <Link href={`/returns/by-order/new?orderId=${r.orderId}`} className="flex h-9 items-center rounded-sm border border-border px-3 text-sm hover:bg-hover">Trả về kho</Link>
                    <button type="button" onClick={() => setRow(r)} aria-label={`Đã xử lý ${r.orderCode}`} className="h-9 rounded-sm bg-accent px-3 text-sm font-medium text-fg-on-accent">Đã xử lý</button>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ReasonDialog open={row !== null} onClose={() => setRow(null)} title={row ? `Ghi nhận đã xử lý ${row.orderCode}` : ""} description="Ghi cách xử lý: giao lại ngày nào, đã hủy đơn, hay đã trả về kho. Lý do bên dưới lưu lại làm dấu vết." confirmLabel="Ghi nhận"
        onConfirm={async (note) => { await apiFetch(`/api/trips/stops/${row!.stopId}/handle`, { method: "POST", json: { note } }); router.refresh(); }} />
    </>
  );
}
