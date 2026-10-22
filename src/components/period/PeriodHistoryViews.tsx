import clsx from "clsx";
import { Eye, Lock } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency, formatDate, formatNumber, formatQty } from "@/lib/format";
import type { PeriodOverview, PeriodRow } from "@/server/period/history";

const TH = "whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-fg-secondary";
const TD = "px-3 py-2.5 text-sm";

/** Banner dùng chung cho mọi màn xem dữ liệu kỳ đã kết sổ: nói rõ chỉ đọc + cách điều chỉnh. */
export function ClosedPeriodBanner({ periodName, closedAt, note }: { periodName: string; closedAt?: Date | null; note?: string }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-md border border-warning bg-warning-soft px-4 py-3 text-sm">
      <Lock size={18} aria-hidden className="mt-0.5 shrink-0 text-warning" />
      <p>
        <strong>Đang xem kỳ đã kết sổ — {periodName}</strong>{closedAt ? ` (kết ngày ${formatDate(closedAt)})` : ""}. Chỉ đọc: không sửa/hủy được.
        {" "}{note ?? "Mọi điều chỉnh đi bằng chứng từ mới ở kỳ đang mở."}
      </p>
    </div>
  );
}

export function PeriodList({ periods }: { periods: PeriodRow[] }) {
  return (
    <>
      {periods.length === 0 && <p className="p-6 text-center text-sm text-fg-secondary">Chưa có kỳ nào để tra cứu.</p>}
      <div className="space-y-3 p-3 md:hidden">
        {periods.map((p) => (
          <article key={p.id} className="rounded-md border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/period/history/${p.id}`} className="flex min-h-11 items-center font-medium text-accent hover:underline">{p.name}</Link>
              <Badge tone={p.status === "OPEN" ? "success" : "neutral"}>{p.status === "OPEN" ? "Đang mở" : "Đã kết sổ"}</Badge>
            </div>
            <dl className="mt-2 space-y-2 text-sm">
              {[
                ["Mở ngày", formatDate(p.openedAt)],
                ["Kết sổ", p.closedAt ? `${formatDate(p.closedAt)}${p.closedByName ? ` · ${p.closedByName}` : ""}` : "—"],
                ["Đơn bán", formatNumber(p.counts.orders)],
                ["Phiếu nhập", formatNumber(p.counts.purchases)],
                ["Thu / Chi", `${formatNumber(p.counts.receipts)} / ${formatNumber(p.counts.payments)}`],
              ].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-fg-secondary">{label}</dt><dd className="tabular text-right">{value}</dd></div>)}
            </dl>
          </article>
        ))}
      </div>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[40rem]">
        <thead className="sticky top-0 z-header bg-hover"><tr className="border-b border-border">
          <th className={TH}>Kỳ</th><th className={TH}>Trạng thái</th><th className={TH}>Mở ngày</th><th className={TH}>Kết sổ</th>
          <th className={clsx(TH, "text-right")}>Đơn</th><th className={clsx(TH, "text-right")}>Phiếu nhập</th><th className={clsx(TH, "text-right")}>Thu / Chi</th><th className={TH}><span className="sr-only">Xem</span></th>
        </tr></thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-0 hover:bg-hover">
              <td className={clsx(TD, "font-medium")}><Link href={`/period/history/${p.id}`} className="text-accent hover:underline">{p.name}</Link></td>
              <td className={TD}>{p.status === "OPEN" ? <Badge tone="success">Đang mở</Badge> : <Badge tone="neutral">Đã kết sổ</Badge>}</td>
              <td className={clsx(TD, "tabular")}>{formatDate(p.openedAt)}</td>
              <td className={clsx(TD, "tabular")}>{p.closedAt ? `${formatDate(p.closedAt)}${p.closedByName ? ` · ${p.closedByName}` : ""}` : "—"}</td>
              <td className={clsx(TD, "tabular text-right")}>{formatNumber(p.counts.orders)}</td>
              <td className={clsx(TD, "tabular text-right")}>{formatNumber(p.counts.purchases)}</td>
              <td className={clsx(TD, "tabular text-right")}>{formatNumber(p.counts.receipts)} / {formatNumber(p.counts.payments)}</td>
              <td className={TD}><Link href={`/period/history/${p.id}`} aria-label={`Xem ${p.name}`} title={`Xem ${p.name}`} className="flex h-9 w-9 items-center justify-center rounded-sm text-fg-secondary hover:bg-active focus-visible:outline focus-visible:outline-accent"><Eye size={16} aria-hidden /></Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

export function PeriodTabs({ id, active, tabs }: { id: number; active: string; tabs: { key: string; label: string }[] }) {
  return (
    <nav aria-label="Nội dung kỳ" className="-mx-1 overflow-x-auto border-b border-border">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link href={t.key === "overview" ? `/period/history/${id}` : `/period/history/${id}?tab=${t.key}`} aria-current={t.key === active ? "page" : undefined}
              className={clsx("-mb-px inline-flex min-h-11 items-center border-b-2 px-4 text-sm font-semibold", t.key === active ? "border-accent text-accent" : "border-transparent text-fg-secondary hover:bg-hover hover:text-fg")}>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const card = "rounded-md border border-border bg-surface p-4";
const Money = ({ v }: { v: string | undefined }) => <>{v === undefined ? "—" : formatCurrency(v)}</>;

export function OverviewTab({ o }: { o: PeriodOverview }) {
  const row = (label: string, open: React.ReactNode, close: React.ReactNode) => (
    <tr className="border-b border-border last:border-0"><th scope="row" className="px-3 py-2.5 text-left text-sm font-medium">{label}</th><td className="tabular px-3 py-2.5 text-right text-sm">{open}</td><td className="tabular px-3 py-2.5 text-right text-sm">{close}</td></tr>
  );
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="w-full min-w-[28rem]">
          <thead><tr className="border-b border-border"><th className={TH}>Chỉ tiêu</th><th className={clsx(TH, "text-right")}>Đầu kỳ</th><th className={clsx(TH, "text-right")}>Cuối kỳ</th></tr></thead>
          <tbody>
            {row("Tồn kho — số lô", formatNumber(o.opening.stockLots), formatNumber(o.closing.stock.lots))}
            {row("Tồn kho — số lượng (ĐV gốc)", formatQty(o.opening.stockQty), formatQty(o.closing.stock.qty))}
            {row("Giá trị tồn kho", <Money v={o.opening.stockValue} />, <Money v={o.closing.stock.value} />)}
            {row("Công nợ phải thu", <Money v={o.opening.receivable} />, <Money v={o.closing.receivable} />)}
            {row("Công nợ phải trả", <Money v={o.opening.payable} />, <Money v={o.closing.payable} />)}
            {row("Số dư quỹ / ngân hàng", <Money v={o.opening.cash} />, <Money v={o.closing.cash} />)}
            {row("Chiết khấu tích lũy", <Money v={o.opening.discount} />, <Money v={o.closing.discount} />)}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-muted">Số cuối kỳ của kỳ đã kết sổ = số đầu kỳ của kỳ kế tiếp. Dấu — = bạn chưa có quyền xem số này.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={card}><p className="text-xs font-semibold text-fg-secondary">Đơn bán hàng</p><p className="tabular mt-1 text-lg font-bold">{formatNumber(o.activity.orders)}</p><p className="text-xs text-fg-secondary">Doanh thu <Money v={o.activity.revenue} /></p></div>
        <div className={card}><p className="text-xs font-semibold text-fg-secondary">Phiếu nhập</p><p className="tabular mt-1 text-lg font-bold">{formatNumber(o.activity.purchases)}</p><p className="text-xs text-fg-secondary">Giá trị <Money v={o.activity.purchaseTotal} /></p></div>
        <div className={card}><p className="text-xs font-semibold text-fg-secondary">Phiếu thu</p><p className="tabular mt-1 text-lg font-bold">{formatNumber(o.activity.receipts)}</p><p className="text-xs text-fg-secondary">Tổng <Money v={o.activity.receiptTotal} /></p></div>
        <div className={card}><p className="text-xs font-semibold text-fg-secondary">Phiếu chi · Trả hàng</p><p className="tabular mt-1 text-lg font-bold">{formatNumber(o.activity.payments)} · {formatNumber(o.activity.returns)}</p><p className="text-xs text-fg-secondary">Chi <Money v={o.activity.paymentTotal} /></p></div>
      </div>
    </div>
  );
}

export interface ReadColumn<T> { label: string; align?: "right"; render: (row: T) => React.ReactNode }
/** Bảng chỉ đọc đơn giản (server component) cho các tab của kỳ. */
export function ReadTable<T>({ columns, rows, rowKey }: { columns: ReadColumn<T>[]; rows: T[]; rowKey: (row: T) => string | number }) {
  return (
    <table className="w-full min-w-[40rem]">
      <thead className="sticky top-0 bg-surface"><tr className="border-b border-border">{columns.map((c) => <th key={c.label} className={clsx(TH, c.align === "right" && "text-right")}>{c.label}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={rowKey(r)} className="border-b border-border last:border-0 hover:bg-hover">
            {columns.map((c) => <td key={c.label} className={clsx(TD, c.align === "right" && "tabular text-right")}>{c.render(r)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
