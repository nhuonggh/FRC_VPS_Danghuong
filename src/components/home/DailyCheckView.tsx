import Link from "next/link";
import type { Actor } from "@/lib/permissions/scope";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, type ListParams } from "@/lib/query-params";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { dailyAmountLabels, dailyRange, loadDailyItem, loadDailyPartners, loadDailySummary, pendingUndeliveredCount, type DailyTotals } from "@/server/home/daily";
import { dailyCanMoney, type DailyKey } from "@/server/home/daily-config";
import { PaginationFooter, QuickTimeFilter, SearchBox } from "@/components/ui";
import { DailyFilters } from "./DailyFilters";
import { DailyPartnerFilter } from "./DailyBoardControls";
import { DailySummaryBoard } from "./DailySummaryBoard";
import { RefreshDashboard } from "./dashboard/RefreshDashboard";
import { ReportExportButton } from "./dashboard/ReportExportButton";
import { DailyReviewControl } from "./DailyReviewControl";
import { canReviewParams, getDailyReviews, reviewState, singleReviewDay } from "@/server/home/daily-review";

const BASE = "/?tab=daily";
function Amounts({ totals, item }: { totals: DailyTotals; item: DailyKey }) {
  if (totals.amount === null) return <span className="text-fg-secondary">—</span>;
  const [label, extra] = dailyAmountLabels(item);
  return <div className="tabular space-y-1"><p>{extra ? `${label}: ` : ""}{formatCurrency(totals.amount)}</p>{extra && <p className="text-sm text-fg-secondary">{extra}: {formatCurrency(totals.extra ?? "0")}</p>}</div>;
}

export async function DailyCheckView({ actor, params, itemKey, now, review }: { actor: Actor; params: ListParams; itemKey?: string; now: Date; review?: string }) {
  try { return await DailyCheckContent({ actor, params, itemKey, now, review }); }
  catch (error) {
    console.error("[home] daily detail", error);
    return <div role="alert" className="space-y-3 rounded-md border border-border bg-surface p-4"><h1 className="text-xl font-semibold">Kiểm tra hằng ngày</h1><p className="text-danger">Chưa tải được mục kiểm tra. Vui lòng thử lại hoặc chọn mục khác.</p><div className="flex items-center gap-3"><RefreshDashboard /><Link href={buildListHref(BASE, { ...params, q: undefined, page: 1, filters: {} }, {})} className="inline-flex min-h-11 items-center text-sm text-accent">Về danh sách kiểm tra</Link></div></div>;
  }
}

async function DailyCheckContent({ actor, params, itemKey, now, review }: { actor: Actor; params: ListParams; itemKey?: string; now: Date; review?: string }) {
  const reviewTab = review === "seen" || review === "unseen" ? review : "all";
  const baseSummary = `/?tab=daily${reviewTab !== "all" ? `&review=${reviewTab}` : ""}`;
  let range;
  try { range = dailyRange(params, now); }
  catch { return <div className="space-y-3"><h1 className="text-xl font-semibold">Kiểm tra hằng ngày</h1><QuickTimeFilter basePath={baseSummary} params={params} allowAll={false} now={now} /><p role="alert" className="text-danger">Vui lòng chọn đủ ngày bắt đầu và kết thúc hợp lệ.</p></div>; }
  const base = itemKey ? `${baseSummary}&item=${encodeURIComponent(itemKey)}` : baseSummary;
  const summaryParams = { ...params, q: undefined, page: 1, filters: Object.fromEntries(Object.entries(params.filters).filter(([key]) => !["state", "type", "method"].includes(key))) };
  const [data, summary, partners] = await Promise.all([
    itemKey ? loadDailyItem(prisma, actor, itemKey, params, now) : Promise.resolve(null),
    loadDailySummary(prisma, actor, summaryParams, now),
    loadDailyPartners(prisma, actor, summaryParams, now).catch((e) => { console.error("[home] daily partners", e); return null; }),
  ]);
  const reviewDay = singleReviewDay(range, now);
  const reviewable = !!reviewDay && canReviewParams(summaryParams);
  const reviews = reviewable ? await getDailyReviews(prisma, actor, reviewDay!).catch((e) => { console.error("[home] daily review state", e); return null; }) : null;
  const reviewMap = new Map((reviews ?? []).map((r) => [r.itemKey, r]));
  const entries = summary.map((r) => {
    const totals = r.totals;
    return { ...r, totals, state: reviewable && reviews !== null && totals?.version ? reviewState(reviewMap.get(r.item.key), totals.version) : undefined };
  });
  const pending = actor.perms.has("trip.manage") ? await pendingUndeliveredCount(prisma, actor).catch((e) => { console.error("[home] pending undelivered", e); return null; }) : undefined;
  const rangeText = `${formatDate(range.start)} – ${formatDate(new Date(range.end.getTime() - 1))}`;
  const [amountLabel, extraLabel] = data ? dailyAmountLabels(data.item.key) : ["", null];
  const detail = <>
    {data && <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{data.item.label}</h3><ReportExportButton href={buildExportHref(`/api/home/daily/export?item=${data.item.key}`, params)} label="Xuất mục này" /></div>}
    <div className="flex flex-wrap items-center gap-3"><DailyFilters basePath={base} params={params} itemKey={data?.item.key} now={now} /><SearchBox basePath={base} params={params} placeholder="Tìm mã chứng từ, đối tác, ghi chú…" /></div>
    {data && <p className="text-xs text-fg-secondary">{formatNumber(data.totals.count)} chứng từ · {formatNumber(data.totals.cancelled)} đã hủy. Tổng giá trị chỉ tính chứng từ còn hiệu lực.</p>}
    {data && <>
      <div className="rounded-md border border-border bg-surface p-3 text-sm"><Amounts totals={data.totals} item={data.item.key} />{!dailyCanMoney(actor, data.item) && <p className="text-fg-secondary">Bạn chưa có quyền xem giá trị của mục này.</p>}</div>
      {data.rows.length === 0 ? <p className="rounded-md border border-border p-6 text-center text-fg-secondary">Không có chứng từ phù hợp. Thử đổi khoảng ngày hoặc bộ lọc.</p> : <>
        <div className="hidden overflow-x-auto rounded-md border border-border bg-surface md:block"><table className="w-full text-sm"><thead className="bg-hover text-left text-xs text-fg-secondary"><tr><th scope="col" className="p-3">Chứng từ / ngày</th><th scope="col" className="p-3">Đối tác / tham chiếu</th>{dailyCanMoney(actor, data.item) && <><th scope="col" className="p-3 text-right">{amountLabel}</th>{extraLabel && <th scope="col" className="p-3 text-right">{extraLabel}</th>}</>}<th scope="col" className="p-3">Trạng thái / ghi chú</th></tr></thead><tbody>{data.rows.map((r) => <tr key={r.id} className="border-t border-border"><td className="p-3">{r.href ? <Link className="font-medium text-accent hover:underline" href={r.href}>{r.code}</Link> : <span className="font-medium">{r.code}</span>}<p className="text-xs text-fg-secondary">{formatDate(r.at)}</p></td><td className="p-3">{r.partner || "—"}<p className="text-xs text-fg-secondary">{r.related}</p></td>{dailyCanMoney(actor, data.item) && <><td className="tabular p-3 text-right">{formatCurrency(r.amount)}</td>{extraLabel && <td className="tabular p-3 text-right">{formatCurrency(r.extra)}</td>}</>}<td className="max-w-xs p-3"><span className={r.cancelled ? "text-danger" : "text-fg-secondary"}>{r.status}</span><p className="whitespace-pre-wrap text-xs text-fg-secondary">{r.note}</p></td></tr>)}</tbody></table></div>
        <ul className="space-y-3 md:hidden">{data.rows.map((r) => <li key={r.id} className="space-y-2 rounded-md border border-border bg-surface p-3"><div className="flex items-center justify-between gap-2">{r.href ? <Link href={r.href} className="inline-flex min-h-11 items-center font-medium text-accent">{r.code}</Link> : <span className="font-medium">{r.code}</span>}<span className={r.cancelled ? "text-sm text-danger" : "text-sm text-fg-secondary"}>{r.status}</span></div><p className="text-sm">{r.partner || "—"} · {formatDate(r.at)}</p>{r.related && <p className="text-sm text-fg-secondary">{r.related}</p>}{dailyCanMoney(actor, data.item) && <Amounts totals={{ count: 1, cancelled: 0, amount: r.amount, extra: r.extra }} item={data.item.key} />}{r.note && <p className="whitespace-pre-wrap text-sm text-fg-secondary">{r.note}</p>}</li>)}</ul>
      </>}
      <PaginationFooter total={data.totals.count} page={data.page} pageSize={params.pageSize} buildHref={(patch) => buildListHref(base, params, patch)} />
    </>}

    {reviewable && canReviewParams(params) && reviews !== null && data?.totals.version && <DailyReviewControl day={reviewDay!} itemKey={data.item.key} version={data.totals.version} initial={reviewState(reviewMap.get(data.item.key), data.totals.version)} />}
    {data && !canReviewParams(params) && <p className="text-xs text-fg-secondary">Bỏ tìm kiếm và bộ lọc chi tiết để xác nhận toàn bộ mục kiểm tra.</p>}
  </>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1"><h1 className="text-xl font-semibold">Kiểm tra hằng ngày</h1><p className="text-sm text-fg-secondary">{rangeText} · Cập nhật {formatDateTime(now)}</p>
        <details className="text-xs text-fg-secondary"><summary className="w-fit cursor-pointer py-1 focus-visible:outline focus-visible:outline-accent">Lưu ý về số liệu</summary><p className="mt-1 max-w-prose">Chỉ tính chứng từ còn hiệu lực. Hao hụt không gồm xuất hủy. Trả hàng theo đơn không gồm hàng chưa giao trả kho. Không cộng tiền giữa các mục vì nghiệp vụ có thể liên quan nhau.</p></details>
      </div>
      <div className="flex items-center gap-2"><RefreshDashboard /><ReportExportButton href={buildExportHref("/api/home/daily/export", summaryParams)} /></div>
    </div>
    {!reviewable && <p className="text-xs text-fg-secondary">Chọn một ngày cụ thể và bỏ tìm kiếm/bộ lọc chi tiết để lưu tiến độ kiểm tra. Tiến độ được lưu riêng theo tài khoản và ngày.</p>}
    {reviewable && reviews === null && <p role="alert" className="text-sm text-danger">Chưa tải được tiến độ kiểm tra. Hãy làm mới để thử lại.</p>}
    {partners === null && <p role="alert" className="text-sm text-danger">Chưa tải được danh sách khách hàng / NCC. Hãy làm mới để thử lại.</p>}
    <DailySummaryBoard entries={entries} params={summaryParams} reviewTab={reviewTab} reviewable={reviewable && reviews !== null} selectedKey={data?.item.key} detail={detail}
      filters={<><DailyPartnerFilter basePath={baseSummary} params={summaryParams} partners={partners ?? []} /><DailyFilters basePath={baseSummary} params={summaryParams} now={now} /></>} />
    {pending !== undefined && <Link href="/delivery/undelivered?state=pending,handled" className="block rounded-md border border-border bg-surface p-3 text-sm text-accent">Hàng giao không hết còn cần giao lại / trả kho hiện tại: {pending === null ? "Chưa tải được" : `${formatNumber(pending)} đơn`} →<span className="mt-1 block text-xs text-fg-secondary">Số đơn hiện tại, không giới hạn theo khoảng ngày phía trên; bao gồm đơn đã ghi nhận hướng xử lý còn hàng.</span></Link>}
    <p className="text-xs text-fg-secondary">File Excel xuất toàn bộ chứng từ theo bộ lọc. Tiến độ kiểm tra tính trên các mục có dữ liệu.</p>
  </div>;
}
