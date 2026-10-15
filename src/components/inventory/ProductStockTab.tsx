import Link from "next/link";
import { formatCurrency, formatDate, formatQty } from "@/lib/format";
import type { ProductStockDTO } from "@/server/inventory-reports/product-stock";

const labels: Record<string, string> = { PURCHASE: "Phiếu nhập hàng", ADJ_IN: "Nhập kho không NCC", OPENING: "Số đầu kỳ", RETURN_IN: "Trả hàng", PRODUCTION_OUT: "Sản xuất" };
const documentHref = (docType: string, docId: number) => docType === "PURCHASE" ? `/purchase/orders/${docId}` : docType === "ADJ_IN" ? `/purchase/adjustments-in/${docId}` : null;

export function ProductStockTab({ stock }: { stock: ProductStockDTO }) {
  const showCost = stock.stockValue !== undefined;
  return <div className="space-y-6">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Tồn hiện tại" value={`${formatQty(stock.onHand)} ${stock.baseUnit}`} />
      <Stat label="Chờ nhập bù" value={Number(stock.pending) > 0 ? `${formatQty(stock.pending)} ${stock.baseUnit}` : "—"} />
      {stock.lastPurchasePrice !== undefined && <Stat label="Giá nhập gần nhất" value={`${formatCurrency(stock.lastPurchasePrice)}/${stock.baseUnit}`} />}
      {showCost && <Stat label="Giá trị tồn" value={formatCurrency(stock.stockValue)} />}
    </div>
    <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Lô còn lại theo FIFO</h2><Link href={`/inventory/ledger?product=${stock.productId}`} className="text-sm font-medium text-accent hover:underline">Xem thẻ kho</Link></div>
    {stock.layers.length === 0 ? <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Không còn lô nào.</p> : <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b border-border bg-hover text-left text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary"><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Nguồn</th><th className="px-3 py-2 text-right">SL nhập</th><th className="px-3 py-2 text-right">SL còn</th>{showCost && <th className="px-3 py-2 text-right">Giá vốn/{stock.baseUnit}</th>}</tr></thead><tbody>{stock.layers.map((layer) => { const href = documentHref(layer.docType, layer.docId); const label = labels[layer.docType] ?? layer.docType; return <tr key={layer.id} className="border-b border-border last:border-b-0"><td className="px-3 py-2 tabular">{formatDate(layer.at)}</td><td className="px-3 py-2">{href ? <Link href={href} className="hover:text-accent hover:underline">{label}</Link> : label}</td><td className="px-3 py-2 text-right tabular">{formatQty(layer.qtyIn)}</td><td className="px-3 py-2 text-right font-medium tabular">{formatQty(layer.qtyRemaining)}</td>{showCost && <td className="px-3 py-2 text-right tabular">{formatCurrency(layer.unitCost)}</td>}</tr>; })}</tbody></table></div>}
  </div>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-border bg-surface p-3"><p className="text-xs text-fg-muted">{label}</p><p className="mt-1 text-base font-semibold tabular">{value}</p></div>; }
