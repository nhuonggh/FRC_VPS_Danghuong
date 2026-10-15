import { requireActor } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { listOrders, ORDER_FILTER_KEYS } from "@/server/sales/queries";
import { DELIVERY_LABEL, PAYMENT_LABEL } from "@/server/sales/status";
import { OrderPrintButton } from "@/components/sales/OrderPrintButton";
import styles from "./print.module.css";

export const dynamic = "force-dynamic";
export default async function OrderPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("order.view");
  const params = parseListParams(await searchParams, ORDER_FILTER_KEYS), now = new Date();
  const { rows, total } = await listOrders(prisma, actor, params, now);
  const money = actor.perms.has("sale_price.view"), debt = actor.perms.has("debt.view");
  return <article className={styles.root}><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Danh sách đơn hàng</h1><p className="text-sm text-fg-secondary">Trang {params.page} · {rows.length} / {total} đơn phù hợp · {formatDateTime(now)}</p><p className="text-xs text-fg-secondary">In các đơn trên trang đang xem, theo bộ lọc đã chọn.</p></div><OrderPrintButton /></div><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left">{["Đơn / ngày", "Khách hàng", "Người tạo", ...(money ? ["Phải thu"] : []), ...(debt ? ["Nợ cũ"] : []), ...(money && debt ? ["Tổng phải trả"] : []), "Giao hàng / ngày giao", "Thanh toán"].map((label) => <th key={label} className="p-2" scope="col">{label}</th>)}</tr></thead><tbody>{rows.map((r) => <tr key={r.id} className="border-b border-border"><td className="p-2">{r.code}{r.isDraft && " (Nháp)"}<br />{formatDate(r.orderDate)}</td><td className="p-2">{r.partnerName}<br />{r.partnerCode}</td><td className="p-2">{r.createdByName}</td>{money && <td className="tabular p-2 text-right">{formatCurrency(r.orderTotal)}</td>}{debt && <td className="tabular p-2 text-right">{formatCurrency(r.oldDebt)}</td>}{money && debt && <td className="tabular p-2 text-right font-semibold">{formatCurrency(r.totalPayable)}</td>}<td className="p-2">{DELIVERY_LABEL[r.deliveryStatus].label}<br />{formatDate(r.expectedDeliveryDate)}</td><td className="p-2">{PAYMENT_LABEL[r.paymentStatus].label}</td></tr>)}</tbody></table>{!rows.length && <p className="p-4 text-fg-secondary">Không có đơn phù hợp trên trang này.</p>}</div></article>;
}
