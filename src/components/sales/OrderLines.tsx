"use client";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui";
import { formatCurrency, formatQty } from "@/lib/format";
import { pricePerM2 } from "@/lib/length-expr";
import type { OrderDetailDTO } from "@/server/sales/queries";

/** Same operational table for everyone; sensitive fields arrive only for authorized accounts. */
export function OrderLines({ order }: { order: OrderDetailDTO }) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const showPrice = order.orderTotal !== undefined, analysis = order.canViewAnalysis === true;
  const showCost = analysis && order.lines.some(l => l.unitCostFifo !== undefined);
  const showProfit = analysis && order.lines.some(l => l.lineProfit !== undefined);
  const columns = 4 + (showPrice ? 4 : 0) + Number(showCost) + Number(showProfit);
  const profit = showProfit && order.lines.every(l => l.lineProfit != null) ? order.lines.reduce((sum, l) => sum + Number(l.lineProfit), 0) : null;
  const cell = "px-3 py-3";
  return <div className="space-y-3"><div className="overflow-x-auto rounded-md border border-border"><table className="line-table w-full text-sm">
    <thead><tr className="border-b border-border bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-3 text-center">STT</th><th className={cell}>Sản phẩm</th><th className={`${cell} text-right`}>SL</th><th className={cell}>ĐVT</th>{showPrice && <><th className={`${cell} text-right`}>Đơn giá</th><th className={`${cell} text-right`}>CK trừ ngay</th><th className={`${cell} text-right`}>CK tích lũy</th><th className={`${cell} text-right`}>Thành tiền</th></>}{showCost && <th className={`${cell} text-right`}>Giá vốn/ĐV gốc</th>}{showProfit && <th className={`${cell} text-right`}>Lãi dòng</th>}</tr></thead>
    <tbody>{order.lines.map((l, index) => {
      const open = expanded.has(l.id), details = analysis && (!!l.issues?.length || !!l.bomVersionLabel);
      return <Fragment key={l.id}><tr className="border-b border-border align-top last:border-b-0 hover:bg-hover">
        <td data-stt className={`${cell} text-center tabular text-fg-secondary`}>{index + 1}</td>
        <td data-label="Sản phẩm" data-wide className={`${cell} min-w-48`}><p className="font-semibold">{l.productName}</p><p className="mt-1 font-mono text-xs text-fg-secondary">{l.productCode}</p>{l.note && <p className="mt-1 text-xs text-fg-secondary">{l.note}</p>}{l.processingType && <p className="mt-1 text-xs text-fg-secondary">Gia công: {l.processingType}</p>}{l.isProvisional && <Badge tone="warning">Chưa đủ tồn</Badge>}{details && <button type="button" aria-expanded={open} aria-controls={`order-materials-${l.id}`} onClick={() => setExpanded(current => { const next = new Set(current); if (open) next.delete(l.id); else next.add(l.id); return next; })} className="mt-1 flex min-h-11 items-center gap-1 text-xs font-medium text-accent md:min-h-9">{open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}{open ? "Ẩn định mức & nguyên liệu" : "Định mức & nguyên liệu"}</button>}</td>
        <td data-label="SL" className={`${cell} text-right tabular`}>{formatQty(l.qty)}{l.areaRatio && <p className="mt-1 whitespace-nowrap text-xs text-fg-secondary">= {formatQty(Math.round(Number(l.qty) * l.areaRatio * 1000) / 1000)} m²</p>}</td>
        <td data-label="ĐVT" className={cell}>{l.unit}</td>
        {showPrice && <><td data-label="Đơn giá" className={`${cell} whitespace-nowrap text-right tabular`}>{l.salePrice !== undefined ? l.areaRatio ? `${formatCurrency(pricePerM2(Number(l.salePrice), l.areaRatio))}/m²` : formatCurrency(l.salePrice) : "—"}</td><td data-label="CK trừ ngay" className={`${cell} text-right tabular text-fg-secondary`}>{formatCurrency(l.discountNow)}</td><td data-label="CK tích lũy" className={`${cell} text-right tabular text-fg-secondary`}>{formatCurrency(l.discountAccum)}</td><td data-label="Thành tiền" className={`${cell} whitespace-nowrap text-right font-semibold tabular`}>{formatCurrency(l.lineAmount)}</td></>}
        {showCost && <td data-label="Giá vốn/ĐV gốc" className={`${cell} text-right tabular text-fg-secondary`}>{l.isProvisional ? "—" : formatCurrency(l.unitCostFifo)}</td>}
        {showProfit && <td data-label="Lãi dòng" className={`${cell} whitespace-nowrap text-right tabular ${Number(l.lineProfit) < 0 ? "text-danger" : "text-success"}`}>{formatCurrency(l.lineProfit)}</td>}
      </tr>{details && open && <tr className="border-b border-border bg-canvas"><td id={`order-materials-${l.id}`} data-wide colSpan={columns} className="px-4 py-3"><div className="space-y-2"><p className="text-xs font-semibold text-fg-secondary">{l.bomVersionLabel ?? "Nguyên vật liệu thực tế"}</p><ul aria-label={`Nguyên vật liệu đã trừ cho ${l.productCode}`} className="grid gap-2 text-sm md:grid-cols-2">{l.issues?.map(i => <li key={i.productCode} className="rounded-sm border border-border bg-surface px-3 py-2"><p className="font-medium">{i.productName} <span className="font-mono text-xs text-fg-secondary">{i.productCode}</span></p><p className="mt-1 text-xs text-fg-secondary">Trừ {formatQty(i.qtyBase)} {i.baseUnit}{Number(i.qtyProvisional) > 0 && <span className="text-warning"> · thiếu tồn {formatQty(i.qtyProvisional)}</span>}{i.materialCost !== undefined && <> · vốn {formatCurrency(i.materialCost)}</>}</p></li>)}</ul></div></td></tr>}</Fragment>;
    })}</tbody>
  </table></div>{showPrice && <div className="flex flex-wrap justify-end gap-x-8 gap-y-3 rounded-sm bg-canvas px-4 py-3">{Number(order.orderDiscount ?? 0) > 0 && <div className="text-right"><p className="text-xs text-fg-secondary">CK cả đơn (đã tính)</p><p className="font-medium tabular">{formatCurrency(order.orderDiscount)}</p></div>}{Number(order.shippingFee ?? 0) > 0 && <div className="text-right"><p className="text-xs text-fg-secondary">Phí vận chuyển</p><p className="font-medium tabular">{formatCurrency(order.shippingFee)}</p></div>}<div className="text-right"><p className="text-xs text-fg-secondary">Tổng thành tiền</p><p className="text-lg font-semibold tabular">{formatCurrency(order.orderTotal)}</p></div>{showProfit && <div className="text-right"><p className="text-xs text-fg-secondary">Tổng lãi dòng</p><p className={`text-lg font-semibold tabular ${profit !== null && profit < 0 ? "text-danger" : "text-success"}`}>{profit === null ? "Chưa chốt vốn" : formatCurrency(profit)}</p></div>}</div>}</div>;
}
