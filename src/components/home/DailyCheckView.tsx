import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import type { Actor } from "@/lib/permissions/scope";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, type ListParams } from "@/lib/query-params";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { dailyAmountLabels, dailyRange, loadDailyItem, loadDailySummary, pendingUndeliveredCount, type DailyTotals } from "@/server/home/daily";
import { dailyCanMoney, type DailyKey } from "@/server/home/daily-config";
import { PaginationFooter, QuickTimeFilter, SearchBox } from "@/components/ui";
import { DailyFilters } from "./DailyFilters";
import { RefreshDashboard } from "./dashboard/RefreshDashboard";
import { ReportExportButton } from "./dashboard/ReportExportButton";

const BASE = "/?tab=daily";
function Amounts({ totals, item }: { totals: DailyTotals; item: DailyKey }) {
  if (totals.amount === null) return <span className="text-fg-secondary">—</span>;
  const [label, extra] = dailyAmountLabels(item);
  return <div className="tabular space-y-1"><p>{extra ? `${label}: ` : ""}{formatCurrency(totals.amount)}</p>{extra && <p className="text-sm text-fg-secondary">{extra}: {formatCurrency(totals.extra ?? "0")}</p>}</div>;
}

export async function DailyCheckView({ actor, params, itemKey, now }: { actor: Actor; params: ListParams; itemKey?: string; now: Date }) {
  try { return await DailyCheckContent({ actor, params, itemKey, now }); }
  catch (error) {
    console.error("[home] daily detail", error);
    return <div role="alert" className="space-y-3 rounded-md border border-border bg-surface p-4"><h1 className="text-xl font-semibold">Kiểm tra hằng ngày</h1><p className="text-danger">Chưa tải được mục kiểm tra. Vui lòng thử lại hoặc chọn mục khác.</p><div className="flex items-center gap-3"><RefreshDashboard /><Link href={buildListHref(BASE, { ...params, q: undefined, page: 1, filters: {} }, {})} className="inline-flex min-h-11 items-center text-sm text-accent">Về danh sách kiểm tra</Link></div></div>;
  }
}

async function DailyCheckContent({ actor, params, itemKey, now }: { actor: Actor; params: ListParams; itemKey?: string; now: Date }) {
  let range;
  try { range = dailyRange(params, now); }
  catch { return <div className="space-y-3"><h1 className="text-xl font-semibold">Kiểm tra hằng ngày</h1><QuickTimeFilter basePath={itemKey ? `${BASE}&item=${encodeURIComponent(itemKey)}` : BASE} params={params} allowAll={false} now={now} /><p role="alert" className="text-danger">Vui lòng chọn đủ ngày bắt đầu và kết thúc hợp lệ.</p></div>; }
  const base = itemKey ? `${BASE}&item=${encodeURIComponent(itemKey)}` : BASE;
  const data = itemKey ? await loadDailyItem(prisma, actor, itemKey, params, now) : null;
  const summary = data ? [] : await loadDailySummary(prisma, actor, params, now);
  const pending = actor.perms.has("trip.manage") ? await pendingUndeliveredCount(prisma, actor).catch((e) => { console.error("[home] pending undelivered", e); return null; }) : undefined;
  const exportPath = `/api/home/daily/export${data ? `?item=${data.item.key}` : ""}`;
  const rangeText = `${formatDate(range.start)} – ${formatDate(new Date(range.end.getTime() - 1))}`;
  const groups = [...new Set(summary.map((r) => r.item.group))];
  const [amountLabel, extraLabel] = data ? dailyAmountLabels(data.item.key) : ["", null];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">{data && <Link href={buildListHref(BASE, { ...params, q: undefined, page: 1, filters: {} }, {})} className="inline-flex min-h-11 items-center gap-1 text-sm text-accent"><ArrowLeft size={16} aria-hidden />Kiểm tra hằng ngày</Link>}
        <h1 className="text-xl font-semibold">{data?.item.label ?? "Kiểm tra hằng ngày"}</h1>
        <p className="text-sm text-fg-secondary">{rangeText} · Cập nhật {formatDateTime(now)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2"><RefreshDashboard /><ReportExportButton href={buildExportHref(exportPath, params)} label={data ? "Xuất mục này" : "Xuất báo cáo"} /></div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <DailyFilters basePath={base} params={params} itemKey={data?.item.key} now={now} />
      {data && <SearchBox basePath={base} params={params} placeholder="Tìm mã chứng từ, đối tác, ghi chú…" />}
    </div>
    <p className="text-sm text-fg-secondary">{data ? `${formatNumber(data.totals.count)} chứng từ · ${formatNumber(data.totals.cancelled)} đã hủy. Tổng giá trị chỉ tính chứng từ còn hiệu lực.` : "Số liệu chỉ tính chứng từ còn hiệu lực. Chọn một mục để xem đầy đủ danh sách."}{(!data || data.item.key === "loss") && " Hao hụt mặc định không gồm xuất hủy."}</p>
    {pending !== undefined && (!data || data.item.key === "undelivered") && <Link href="/delivery/undelivered?state=pending,handled" className="block rounded-md border border-border bg-surface p-3 text-sm text-accent">Hàng giao không hết còn cần giao lại / trả kho hiện tại: {pending === null ? "Chưa tải được" : `${formatNumber(pending)} đơn`} →<span className="mt-1 block text-xs text-fg-secondary">Số đơn hiện tại, không giới hạn theo khoảng ngày phía trên; bao gồm đơn đã ghi nhận hướng xử lý còn hàng.</span></Link>}
    {!data && groups.map((group) => <section key={group} aria-label={group} className="overflow-hidden rounded-md border border-border bg-surface">
      <h2 className="border-b border-border bg-hover px-4 py-3 text-sm font-semibold">{group}</h2>
      <div className="hidden grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)_3rem] gap-3 border-b border-border px-4 py-2 text-xs text-fg-secondary md:grid"><span>Mục kiểm tra</span><span className="text-right">Số chứng từ</span><span className="text-right">Giá trị (VND)</span><span /></div>
      <ul>{summary.filter((r) => r.item.group === group).map(({ item, totals }) => <li key={item.key} className="border-b border-border last:border-0">
        <Link href={buildListHref(`${BASE}&item=${item.key}`, { ...params, page: 1, q: undefined, filters: {} }, {})} className="flex min-h-11 flex-wrap items-center gap-3 p-4 hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:grid md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)_3rem]">
          <span className="w-full font-medium md:w-auto">{item.label}</span>
          {totals ? <><span className="tabular text-sm md:text-right">{formatNumber(totals.count)}<span className="md:hidden"> chứng từ</span></span><div className="ml-auto text-right text-sm md:ml-0"><Amounts totals={totals} item={item.key} /></div></> : <span role="status" className="text-sm text-danger md:col-span-2 md:text-right">Chưa tải được · bấm để thử lại</span>}
          <ChevronRight size={18} aria-hidden className="ml-auto text-fg-secondary" />
        </Link>
      </li>)}</ul>
    </section>)}
    {!data && summary.length === 0 && <p className="rounded-md border border-border p-4">Bạn chưa được cấp quyền xem các mục kiểm tra.</p>}
    {data && <>
      <div className="rounded-md border border-border bg-surface p-3 text-sm"><Amounts totals={data.totals} item={data.item.key} />{!dailyCanMoney(actor, data.item) && <p className="text-fg-secondary">Bạn chưa có quyền xem giá trị của mục này.</p>}</div>
      {data.rows.length === 0 ? <p className="rounded-md border border-border p-6 text-center text-fg-secondary">Không có chứng từ phù hợp. Thử đổi khoảng ngày hoặc bộ lọc.</p> : <>
        <div className="hidden overflow-x-auto rounded-md border border-border bg-surface md:block"><table className="w-full text-sm"><thead className="bg-hover text-left text-xs text-fg-secondary"><tr><th scope="col" className="p-3">Chứng từ / ngày</th><th scope="col" className="p-3">Đối tác / tham chiếu</th>{dailyCanMoney(actor, data.item) && <><th scope="col" className="p-3 text-right">{amountLabel}</th>{extraLabel && <th scope="col" className="p-3 text-right">{extraLabel}</th>}</>}<th scope="col" className="p-3">Trạng thái / ghi chú</th></tr></thead><tbody>{data.rows.map((r) => <tr key={r.id} className="border-t border-border"><td className="p-3">{r.href ? <Link className="font-medium text-accent hover:underline" href={r.href}>{r.code}</Link> : <span className="font-medium">{r.code}</span>}<p className="text-xs text-fg-secondary">{formatDate(r.at)}</p></td><td className="p-3">{r.partner || "—"}<p className="text-xs text-fg-secondary">{r.related}</p></td>{dailyCanMoney(actor, data.item) && <><td className="tabular p-3 text-right">{formatCurrency(r.amount)}</td>{extraLabel && <td className="tabular p-3 text-right">{formatCurrency(r.extra)}</td>}</>}<td className="max-w-xs p-3"><span className={r.cancelled ? "text-danger" : "text-fg-secondary"}>{r.status}</span><p className="whitespace-pre-wrap text-xs text-fg-secondary">{r.note}</p></td></tr>)}</tbody></table></div>
        <ul className="space-y-3 md:hidden">{data.rows.map((r) => <li key={r.id} className="space-y-2 rounded-md border border-border bg-surface p-3"><div className="flex items-center justify-between gap-2">{r.href ? <Link href={r.href} className="inline-flex min-h-11 items-center font-medium text-accent">{r.code}</Link> : <span className="font-medium">{r.code}</span>}<span className={r.cancelled ? "text-sm text-danger" : "text-sm text-fg-secondary"}>{r.status}</span></div><p className="text-sm">{r.partner || "—"} · {formatDate(r.at)}</p>{r.related && <p className="text-sm text-fg-secondary">{r.related}</p>}{dailyCanMoney(actor, data.item) && <Amounts totals={{ count: 1, cancelled: 0, amount: r.amount, extra: r.extra }} item={data.item.key} />}{r.note && <p className="whitespace-pre-wrap text-sm text-fg-secondary">{r.note}</p>}</li>)}</ul>
      </>}
      <PaginationFooter total={data.totals.count} page={data.page} pageSize={params.pageSize} buildHref={(patch) => buildListHref(base, params, patch)} />
    </>}
    <p className="text-xs text-fg-secondary">Trả theo đơn không gồm hàng chưa giao trả kho. Không cộng tiền giữa các mục vì nghiệp vụ có thể liên quan nhau. File Excel xuất toàn bộ chứng từ theo bộ lọc.</p>
  </div>;
}
