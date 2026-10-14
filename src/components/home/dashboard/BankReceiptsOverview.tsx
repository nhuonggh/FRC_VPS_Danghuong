import Link from "next/link";
import { ArrowUpRight, CircleCheck, Clock3, Info, Landmark, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import type { ListParams } from "@/lib/query-params";
import type { BankReceiptsOverview as Overview } from "@/server/home/dashboard/types";
import { BankAccountFilter } from "./BankAccountFilter";

const actionClass = "inline-flex min-h-11 items-center gap-2 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover focus-visible:outline focus-visible:outline-accent";

export function BankReceiptsOverview({ data, params }: { data: Overview; params: ListParams }) {
  const accounts = data.accounts.filter((a) => data.selectedAccount === null || a.id === data.selectedAccount);
  const pending = data.pending + data.returned;
  const cards = [
    { label: "Ngân hàng thực nhận", value: "Chưa có sao kê", hint: "Chưa xác định số tiền thực nhận", icon: Landmark, tone: "bg-info-soft text-info" },
    { label: "Thu ngân hàng đã ghi sổ", value: formatCurrency(data.recorded), hint: "Phiếu thu còn hiệu lực trong khoảng xem", icon: ListChecks, tone: "bg-accent-soft text-accent" },
    { label: "Phiếu thu đã hậu kiểm", value: `${formatNumber(data.reviewed)} phiếu`, hint: "Chưa xác nhận khớp với sao kê", icon: CircleCheck, tone: "bg-success-soft text-success" },
    { label: "Phiếu thu cần kiểm tra", value: `${formatNumber(pending)} phiếu`, hint: data.returned ? `${formatNumber(data.returned)} phiếu bị trả lại` : "Chờ hậu kiểm chứng từ", icon: Clock3, tone: "bg-warning-soft text-warning", href: data.tasksHref },
  ];
  return <section aria-labelledby="bank-receipts-title" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="bank-receipts-title" className="text-base font-semibold">Kiểm tra tiền nhận ngân hàng</h2><p className="text-sm text-fg-secondary">Theo dõi tiền ghi sổ và phiếu thu cần xử lý trong khoảng thời gian đã chọn.</p></div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto"><BankAccountFilter accounts={data.accounts} selected={data.selectedAccount} params={params} />{data.bookHref && <Link href={data.bookHref} className={actionClass}>Sổ tiền gửi<ArrowUpRight size={16} aria-hidden /></Link>}</div>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => { const Icon = c.icon; const body = <><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${c.tone}`}><Icon size={20} aria-hidden /></span><div className="min-w-0"><p className="text-sm text-fg-secondary">{c.label}</p><p className="tabular break-words text-lg font-semibold">{c.value}</p><p className="mt-1 text-xs text-fg-secondary">{c.hint}</p></div></>; const cls = "flex min-w-0 items-start gap-3 rounded-md border border-border bg-surface p-4"; return c.href ? <Link key={c.label} href={c.href} className={`${cls} hover:bg-hover focus-visible:outline focus-visible:outline-accent`}>{body}</Link> : <div key={c.label} className={cls}>{body}</div>; })}
    </div>
    <div role="status" className="flex items-start gap-2 rounded-md border border-border bg-info-soft p-3 text-sm text-fg-secondary"><Info size={18} className="mt-0.5 shrink-0 text-info" aria-hidden /><p>Chưa có sao kê để đối chiếu tiền thực nhận và khách hàng. Trạng thái hậu kiểm bên dưới phản ánh việc kiểm tra phiếu thu trên sổ.</p></div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <section aria-labelledby="bank-accounts-title" className="min-w-0 rounded-md border border-border bg-surface p-4 xl:col-span-7">
        <h3 id="bank-accounts-title" className="font-semibold">Theo tài khoản ngân hàng</h3>
        <p className="mb-3 mt-1 text-xs text-fg-secondary">Tiền thực nhận và chênh lệch sẽ có sau khi đối chiếu sao kê.</p>
        {accounts.length === 0 ? <p className="py-6 text-center text-sm text-fg-secondary">Chưa có tài khoản ngân hàng.</p> : <>
          <table className="hidden w-full text-sm md:table"><thead><tr className="border-b border-border text-left text-xs text-fg-secondary"><th scope="col" className="py-2">Tài khoản</th><th scope="col" className="px-2 py-2 text-right">Thu ghi sổ</th><th scope="col" className="px-2 py-2 text-right">Cần kiểm tra</th><th scope="col" className="py-2 text-right">Sao kê</th></tr></thead><tbody>{accounts.map((a) => <tr key={a.id} className="border-b border-border last:border-0"><td className="py-3">{a.bookHref ? <Link href={a.bookHref} className="font-medium text-accent hover:underline">{a.name}</Link> : a.name}{a.bankNo && <span className="block text-xs text-fg-secondary">{a.bankNo}</span>}</td><td className="tabular px-2 py-3 text-right">{formatCurrency(a.recorded)}</td><td className="tabular px-2 py-3 text-right"><Badge tone={a.pending + a.returned ? "warning" : "neutral"}>{formatNumber(a.pending + a.returned)}</Badge></td><td className="py-3 text-right text-xs text-fg-secondary">Chưa có sao kê</td></tr>)}</tbody></table>
          <ul className="divide-y divide-border md:hidden">{accounts.map((a) => <li key={a.id} className="space-y-2 py-3"><div className="flex items-start justify-between gap-2"><div>{a.bookHref ? <Link href={a.bookHref} className="inline-flex min-h-11 items-center font-medium text-accent">{a.name}</Link> : a.name}{a.bankNo && <p className="text-xs text-fg-secondary">{a.bankNo}</p>}</div><Badge tone={a.pending + a.returned ? "warning" : "neutral"}>{formatNumber(a.pending + a.returned)} cần kiểm tra</Badge></div><div className="flex justify-between gap-2 text-sm"><span className="text-fg-secondary">Thu ghi sổ</span><span className="tabular font-medium">{formatCurrency(a.recorded)}</span></div><p className="text-xs text-fg-secondary">Chưa có sao kê</p></li>)}</ul>
        </>}
      </section>
      <section aria-labelledby="bank-tasks-title" className="min-w-0 rounded-md border border-border bg-surface p-4 xl:col-span-5">
        <div className="flex items-center justify-between gap-2"><h3 id="bank-tasks-title" className="font-semibold">Việc cần xử lý <span className="tabular text-fg-secondary">({formatNumber(pending)})</span></h3>{data.tasksHref && <Link href={data.tasksHref} className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">Xem tất cả →</Link>}</div>
        <p className="mb-2 text-xs text-fg-secondary">Ưu tiên phiếu bị trả lại, sau đó phiếu chờ lâu nhất.</p>
        {data.tasks.length === 0 ? <div className="flex items-start gap-2 rounded-md bg-canvas p-4 text-sm text-fg-secondary"><CircleCheck size={18} className="shrink-0 text-success" aria-hidden /><p>Không có phiếu thu ngân hàng chờ hậu kiểm trong khoảng đã chọn.</p></div> : <ul className="divide-y divide-border">{data.tasks.map((t) => <li key={t.id} className="py-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-medium">{t.partnerName ?? "Thu khác — không gắn đối tượng"}</p><p className="mt-1 text-xs text-fg-secondary">{t.accountName} · {formatDateTime(t.at)}</p></div><span className="tabular shrink-0 text-sm font-semibold">{formatCurrency(t.amount)}</span></div><div className="mt-2 flex items-center justify-between gap-2"><Badge tone={t.status === "RETURNED" ? "danger" : "warning"}>{t.status === "RETURNED" ? "Bị trả lại" : "Chờ kiểm tra"}</Badge>{t.href ? <Link href={t.href} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent">{t.code}<ArrowUpRight size={14} aria-hidden /></Link> : <span className="font-mono text-xs">{t.code}</span>}</div></li>)}</ul>}
      </section>
    </div>
  </section>;
}
