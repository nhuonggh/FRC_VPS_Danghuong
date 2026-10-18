"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClipboardList, Undo2 } from "lucide-react";
import { FormCard, FormGrid, igArea, igInput, InlineField, inputClass, NewPage, NumberInput, type ComboOption } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatQty } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { ReturnableOrderDTO } from "@/server/returns/queries";

/**
 * Trả theo đơn (mã 43): chọn SL trả từng dòng đã giao. Vốn nhập lại + tiền trừ công nợ do server tính từ dòng bán gốc.
 * Chế độ `order.undelivered` (từ “Hàng không giao được”): trả về kho phần CHƯA giao — chỉ nhập kho, không trừ công nợ.
 */
export function ReturnByOrderForm({ order, today, refundAccounts, selection }: { selection?: React.ReactNode; order: ReturnableOrderDTO; today: string; /** Quỹ/ngân hàng để hoàn tiền khách (thiếu quyền chi hoặc trả hàng chưa giao ⇒ không có ô hoàn tiền). */ refundAccounts?: (ComboOption & { type: "CASH" | "BANK" })[] }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const cashList = (refundAccounts ?? []).filter((a) => a.type === "CASH"), bankList = (refundAccounts ?? []).filter((a) => a.type === "BANK");
  const [cashRefund, setCashRefund] = useState(""), [cashAcc, setCashAcc] = useState<number | "">(cashList[0] ? Number(cashList[0].value) : "");
  const [bankRefund, setBankRefund] = useState(""), [bankAcc, setBankAcc] = useState<number | "">(bankList[0] ? Number(bankList[0].value) : "");
  const isDirty = () => Object.values(qty).some((v) => v !== "") || date !== today || note !== "" || cashRefund !== "" || bankRefund !== "";

  async function submit() {
    const lines = order.lines.flatMap((l) => (Number(qty[l.id]) > 0 ? [{ orderLineId: l.id, qty: Number(qty[l.id]) }] : []));
    if (!lines.length) throw new Error("Nhập số lượng trả cho ít nhất một dòng.");
    const cash = Number(cashRefund) || 0, bank = Number(bankRefund) || 0;
    if (cash > 0 && cashAcc === "") throw new Error("Chọn quỹ tiền mặt để hoàn tiền.");
    if (bank > 0 && bankAcc === "") throw new Error("Chọn tài khoản ngân hàng để hoàn tiền.");
    const refunds = [...(cash > 0 ? [{ amount: cash, cashAccountId: Number(cashAcc) }] : []), ...(bank > 0 ? [{ amount: bank, cashAccountId: Number(bankAcc) }] : [])];
    const r = await apiFetch<{ id: number }>("/api/returns/by-order", { method: "POST", json: { orderId: order.id, date, note, lines, ...(refunds.length ? { refunds } : {}), ...(order.undelivered ? { undelivered: true } : {}) }, idempotencyKey: idem.key });
    router.replace(`/returns/${r.id}`);
  }

  return (
    <NewPage wide bare backHref={`/sales/orders/${order.id}`} backLabel={`Quay lại đơn ${order.code}`} title={order.undelivered ? `Trả hàng chưa giao về kho — đơn ${order.code}` : `Trả hàng theo đơn ${order.code}`} submitLabel="Lập phiếu trả" isDirty={isDirty} onSubmit={submit}>
      {selection}
      <FormCard icon={Undo2} title="Thông tin trả hàng">

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
      {refundAccounts && (
        <FormCard icon={Undo2} title="Hoàn tiền cho khách">

          <FormGrid cols={2}>
            <InlineField id="ret-cash" label="Hoàn tiền mặt"><NumberInput id="ret-cash" value={cashRefund} placeholder="0" onValueChange={setCashRefund} className={`${igInput} tabular text-right`} /></InlineField>
            {cashList.length > 1 ? <InlineField id="ret-cash-acc" label="Quỹ tiền mặt"><select id="ret-cash-acc" value={cashAcc} onChange={(e) => setCashAcc(Number(e.target.value))} className={igInput}>{cashList.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></InlineField> : <span />}
            <InlineField id="ret-bank" label="Hoàn chuyển khoản"><NumberInput id="ret-bank" value={bankRefund} placeholder="0" onValueChange={setBankRefund} className={`${igInput} tabular text-right`} /></InlineField>
            {bankList.length > 1 ? <InlineField id="ret-bank-acc" label="Tài khoản ngân hàng"><select id="ret-bank-acc" value={bankAcc} onChange={(e) => setBankAcc(Number(e.target.value))} className={igInput}>{bankList.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></InlineField> : <span />}
          </FormGrid>
        </FormCard>
      )}
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
      {order.undelivered && <p className="mb-3 rounded-sm border border-border bg-hover px-3 py-2 text-sm text-fg-secondary">Trả về kho phần hàng <strong>chưa giao</strong>. Sau khi lưu phiếu, số lượng trả kho không còn được xếp giao lại trong đơn này; nếu trả một phần thì chỉ phần còn lại được giao. Chỉ nhập lại kho theo giá vốn; công nợ của khách không đổi vì chưa ghi nợ phần này.</p>}
      {refundAccounts && <p className="mb-3 text-sm text-fg-secondary">{order.partnerIsRetail ? "Khách lẻ không ghi nợ — nhập số tiền hoàn lại ngay (bằng giá trị hàng trả); nếu để trống, giá trị hàng trả sẽ thành khoản mình nợ khách." : "Tuỳ chọn: hoàn tiền mặt/chuyển khoản cho khách ngay. Phần không hoàn được trừ vào công nợ của khách."} Số tiền hoàn tối đa bằng giá trị hàng trả (hệ thống tính theo đơn gốc).</p>}
    </NewPage>
  );
}
