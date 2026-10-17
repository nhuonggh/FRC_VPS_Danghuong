"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { NewPage, NumberInput, igInput, igArea } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatQty } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { receiveOrderSchema } from "@/server/supplier-orders/schemas";
export function SupplierOrderReceive({ id, code, today, lines }: { id: number; code: string; today: string; lines: { lineId: number; label: string; unit: string; ordered: string; received: string; remaining: string; purchasePrice: string }[] }) {
  const router = useRouter(), idem = useIdempotencyKey();
  const [rows, setRows] = useState(lines.map(l => ({ ...l, qty: "" }))), [date, setDate] = useState(today), [freight, setFreight] = useState("0"), [note, setNote] = useState(""), [excess, setExcess] = useState("");
  const over = rows.some(l => Number(l.qty) > Number(l.remaining));
  const submit = async () => {
    if (rows.some(l => Number(l.qty) > 0 && l.purchasePrice.trim() === "")) throw new Error("Nhập đơn giá thực tế cho các dòng nhận hàng.");
    if (over && !excess.trim()) throw new Error("Nhập lý do xác nhận nhận thừa.");
    const input = receiveOrderSchema.parse({ date, freightCost: Number(freight), note, excessReason: excess, lines: rows.filter(l => l.qty !== "" && Number(l.qty) !== 0).map(l => ({ lineId: l.lineId, qty: Number(l.qty), purchasePrice: Number(l.purchasePrice) })) });
    await apiFetch(`/api/supplier-orders/${id}/receive`, { method: "POST", json: input, idempotencyKey: idem.key });
    router.replace(`/purchase/supplier-orders/${id}`); router.refresh();
  };
  return <NewPage wide bare title={`Nhận hàng · ${code}`} backHref={`/purchase/supplier-orders/${id}`} backLabel="Quay lại đơn đặt" submitLabel="Xác nhận nhận và nhập kho" isDirty={() => rows.some(l => !!l.qty) || !!note} onSubmit={submit}>
    <p className="text-sm text-fg-secondary">Các đơn đang chờ của cùng nhà cung cấp được gom bên dưới. Nhập số lượng thực nhận theo đúng mã đơn, để trống dòng chưa giao. Xác nhận sẽ tạo phiếu nhập, ghi tồn kho và công nợ nhà cung cấp.</p>
    <div className="grid gap-3 md:grid-cols-2"><label className="space-y-1 text-sm">Ngày nhận<input type="date" max={today} value={date} onChange={e => setDate(e.target.value)} className={igInput} /></label><label className="space-y-1 text-sm">Cước vận chuyển<NumberInput value={freight} onValueChange={setFreight} maxFrac={2} className={igInput} /></label></div>
    <div className="overflow-hidden rounded-sm border border-border bg-surface"><table className="line-table w-full text-sm"><thead className="bg-hover text-left text-xs text-fg-secondary"><tr>{["Sản phẩm", "Đặt", "Đã nhận", "Còn thiếu", "Thực nhận lần này", "Giá nhập thực tế"].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((l, i) => <tr key={l.lineId} className="border-t border-border"><td className="p-3" data-label="Sản phẩm">{l.label} · {l.unit}</td><td className="p-3 text-right tabular" data-label="Đặt">{formatQty(l.ordered)}</td><td className="p-3 text-right tabular" data-label="Đã nhận">{formatQty(l.received)}</td><td className="p-3 text-right tabular" data-label="Còn thiếu">{formatQty(l.remaining)}</td><td className="p-3" data-label="Thực nhận lần này"><NumberInput aria-label={`Thực nhận ${l.label}`} value={l.qty} maxFrac={3} className={`${igInput} text-right tabular`} onValueChange={qty => setRows(r => r.map((v, j) => j === i ? { ...v, qty } : v))} /></td><td className="p-3" data-label="Giá nhập thực tế"><NumberInput aria-label={`Giá nhập ${l.label}`} value={l.purchasePrice} maxFrac={2} className={`${igInput} text-right tabular`} onValueChange={purchasePrice => setRows(r => r.map((v, j) => j === i ? { ...v, purchasePrice } : v))} /></td></tr>)}</tbody></table></div>
    {over && <label className="block space-y-2 text-sm text-warning">Có sản phẩm giao thừa. Nhập lý do để xác nhận chấp nhận số lượng vượt đặt.<textarea value={excess} maxLength={300} onChange={e => setExcess(e.target.value)} className={igArea} /></label>}
    <label className="block space-y-2 text-sm">Ghi chú giao hàng / chênh lệch<textarea value={note} maxLength={500} onChange={e => setNote(e.target.value)} className={igArea} /></label>
  </NewPage>;
}
