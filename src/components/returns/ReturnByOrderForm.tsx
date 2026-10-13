"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClipboardList, Undo2 } from "lucide-react";
import { FormCard, FormGrid, igArea, igInput, InlineField, inputClass, NewPage, NumberInput } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatQty } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { ReturnableOrderDTO } from "@/server/returns/queries";

/**
 * Trả theo đơn (mã 43): chọn SL trả từng dòng đã giao. Vốn nhập lại + tiền trừ công nợ do server tính từ dòng bán gốc.
 * Chế độ `order.undelivered` (từ “Hàng không giao được”): trả về kho phần CHƯA giao — chỉ nhập kho, không trừ công nợ.
 */
export function ReturnByOrderForm({ order, today }: { order: ReturnableOrderDTO; today: string }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const isDirty = () => Object.values(qty).some((v) => v !== "") || note !== "";

  async function submit() {
    const lines = order.lines.flatMap((l) => (Number(qty[l.id]) > 0 ? [{ orderLineId: l.id, qty: Number(qty[l.id]) }] : []));
    if (!lines.length) throw new Error("Nhập số lượng trả cho ít nhất một dòng.");
    const r = await apiFetch<{ id: number }>("/api/returns/by-order", { method: "POST", json: { orderId: order.id, date, note, lines, ...(order.undelivered ? { undelivered: true } : {}) }, idempotencyKey: idem.key });
    router.replace(`/returns/${r.id}`);
  }

  return (
    <NewPage wide bare backHref={`/sales/orders/${order.id}`} backLabel={`Quay lại đơn ${order.code}`} title={order.undelivered ? `Trả hàng chưa giao về kho — đơn ${order.code}` : `Trả hàng theo đơn ${order.code}`} submitLabel="Lập phiếu trả" isDirty={isDirty} onSubmit={submit}>
      <FormCard icon={Undo2} title="Thông tin trả hàng">
        {order.undelivered && <p className="mb-3 rounded-sm border border-border bg-hover px-3 py-2 text-sm text-fg-secondary">Trả về kho phần hàng <strong>chưa giao</strong>. Chỉ nhập lại kho theo giá vốn; công nợ của khách không đổi vì chưa ghi nợ phần này.</p>}
        <p className="mb-3 text-sm text-fg-secondary">{order.partnerCode} — {order.partnerName} · đơn ngày {formatDate(order.orderDate)}</p>
        <FormGrid cols={2}>
          <InlineField id="date" label="Ngày trả" required>
            <input id="date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={igInput} />
          </InlineField>
          <InlineField id="note" label="Ghi chú" multiline>
            <textarea id="note" rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className={igArea} />
          </InlineField>
        </FormGrid>
      </FormCard>
      <FormCard icon={ClipboardList} title={order.undelivered ? "Dòng hàng chưa giao" : "Dòng hàng đã giao"}>
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
              <th className="px-3 py-2">Sản phẩm</th><th className="px-3 py-2">ĐVT</th>{order.undelivered && <th className="px-3 py-2 text-right">Đặt</th>}<th className="px-3 py-2 text-right">Đã giao</th><th className="px-3 py-2 text-right">{order.undelivered ? "Đã trả về kho" : "Đã trả"}</th><th className="px-3 py-2 text-right">Còn trả được</th><th className="px-3 py-2 text-right">SL trả</th>
            </tr></thead>
            <tbody>
              {order.lines.map((l, i) => (
                <tr key={l.id} className="border-t border-border align-top">
                  <td className="px-3 py-2"><strong>{l.productName}</strong><span className="block font-mono text-xs text-fg-muted">{l.productCode}</span>{l.processingTypeName && <span className="block text-xs text-fg-secondary">Kiểu gia công: {l.processingTypeName}</span>}{!l.returnable && <span className="block text-xs text-fg-muted">Hàng gia công theo định mức — không trả theo đơn</span>}</td>
                  <td className="px-3 py-2">{l.unit}</td>
                  {order.undelivered && <td className="px-3 py-2 text-right tabular">{formatQty(l.ordered)}</td>}
                  <td className="px-3 py-2 text-right tabular">{formatQty(l.delivered)}</td>
                  <td className="px-3 py-2 text-right tabular">{formatQty(l.returned)}</td>
                  <td className="px-3 py-2 text-right tabular">{formatQty(l.remaining)}</td>
                  <td className="px-3 py-2 text-right">
                    <NumberInput maxFrac={3} aria-label={`SL trả dòng ${i + 1}`} disabled={!l.returnable || Number(l.remaining) <= 0} value={qty[l.id] ?? ""}
                      onValueChange={(val) => setQty((m) => ({ ...m, [l.id]: val }))} className={`${inputClass()} min-w-24 tabular text-right`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FormCard>
    </NewPage>
  );
}
