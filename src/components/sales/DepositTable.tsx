import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { DepositActions } from "./DepositActions";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import type { DepositRowDTO } from "@/server/deposits/queries";

function Status({ row }: { row: DepositRowDTO }) {
  return row.isCancelled ? <Badge tone="danger">Đã hủy</Badge> : row.orderId === null ? <Badge tone="info">Số dư khách</Badge> : <Badge tone="success">Gắn đơn</Badge>;
}
function Order({ row, canOpen }: { row: DepositRowDTO; canOpen: boolean }) {
  return row.orderCode ? canOpen ? <Link href={`/sales/orders/${row.orderId}?tab=deposit`} className="font-mono text-xs font-semibold text-accent hover:underline">{row.orderCode}</Link> : <span className="font-mono text-xs">{row.orderCode}</span> : <span className="text-fg-secondary">—</span>;
}
function Actions({ row }: { row: DepositRowDTO }) {
  return !row.isCancelled && <DepositActions id={row.id} code={row.code} attached={row.orderId !== null} reviewed={row.reviewed} cashAccountName={row.cashAccountName} iconOnly />;
}
export function DepositTable({ rows, canOpen }: { rows: DepositRowDTO[]; canOpen: boolean }) {
  return <>
    <div className="hidden overflow-x-auto md:block"><table className="w-full text-sm">
      <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
        {["Mã phiếu", "Ngày", "Khách hàng", "Đơn", "Số tiền", "Quỹ", "Trạng thái"].map((label) => <th key={label} scope="col" className={`whitespace-nowrap px-3 py-3 ${label === "Số tiền" ? "text-right" : ""}`}>{label}</th>)}<th scope="col" className="px-3 py-3"><span className="sr-only">Thao tác</span></th>
      </tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id} className={`border-t border-border align-middle hover:bg-hover ${row.isCancelled ? "text-fg-secondary" : ""}`}>
        <td className="px-3 py-3 font-mono text-xs font-semibold">{row.code}</td>
        <td className="whitespace-nowrap px-3 py-3"><span className="block font-medium">{formatDate(row.at)}</span><span className="block text-xs text-fg-secondary">{formatDateTime(row.at).split(" ")[0]}</span></td>
        <td className="px-3 py-3 font-medium">{row.partnerName}</td><td className="px-3 py-3"><Order row={row} canOpen={canOpen} /></td>
        <td className={`whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums ${row.isCancelled ? "line-through" : ""}`}>{formatCurrency(row.amount)}</td>
        <td className="px-3 py-3 text-xs text-fg-secondary">{row.cashAccountName}</td><td className="px-3 py-3"><Status row={row} /></td><td className="px-3 py-3 text-right"><Actions row={row} /></td>
      </tr>)}</tbody>
    </table></div>
    <ul className="space-y-3 p-3 md:hidden">{rows.map((row) => <li key={row.id} className="rounded-md border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3"><span className="font-mono text-xs font-semibold">{row.code}</span><Status row={row} /></div>
      <p className="mt-3 font-medium">{row.partnerName}</p>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-fg-secondary">Ngày</dt><dd>{formatDateTime(row.at)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-fg-secondary">Đơn</dt><dd><Order row={row} canOpen={canOpen} /></dd></div>
        <div className="flex justify-between gap-3"><dt className="text-fg-secondary">Số tiền</dt><dd className={`font-semibold tabular-nums ${row.isCancelled ? "text-fg-secondary line-through" : ""}`}>{formatCurrency(row.amount)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-fg-secondary">Quỹ</dt><dd className="text-right">{row.cashAccountName}</dd></div>
      </dl>
      {!row.isCancelled && <div className="mt-3 flex justify-end border-t border-border pt-3"><Actions row={row} /></div>}
    </li>)}</ul>
  </>;
}
