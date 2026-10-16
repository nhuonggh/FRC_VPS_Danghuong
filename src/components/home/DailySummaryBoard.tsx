import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { formatCurrency, formatNumber } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { dailyAmountLabels, type DailySummary } from "@/server/home/daily";
import type { ReviewState } from "@/server/home/daily-review";
import { DailyReviewBadge } from "./DailyReviewControl";
import { DailyEmptyToggle } from "./DailyBoardControls";

export type DailyBoardEntry = DailySummary & { state?: ReviewState };
const GROUP_STYLES = [
  { key: "returns", label: "Trả hàng & kho", header: "border-warning bg-warning-soft text-warning", dot: "bg-warning" },
  { key: "debt", label: "Công nợ & chiết khấu", header: "border-tertiary bg-tertiary-soft text-tertiary", dot: "bg-tertiary" },
  { key: "cash", label: "Thu chi & nhập hàng", header: "border-info bg-info-soft text-info", dot: "bg-info" },
];
const isSeen = (r: DailyBoardEntry) => r.state?.status === "seen" || r.state?.status === "checked";

export function DailySummaryBoard({ entries, params, reviewTab, reviewable, selectedKey, detail, filters }: {
  entries: DailyBoardEntry[]; params: ListParams; reviewTab: string; reviewable: boolean;
  selectedKey?: string; detail?: ReactNode; filters: ReactNode;
}) {
  const base = `/?tab=daily${reviewTab !== "all" ? `&review=${reviewTab}` : ""}`;
  const active = entries.filter((r) => r.totals && r.totals.count > 0);
  const empty = entries.filter((r) => r.totals?.count === 0).length;
  const failures = entries.filter((r) => !r.totals).length;
  const seen = active.filter(isSeen).length, checked = active.filter((r) => r.state?.status === "checked").length;
  const unseen = active.length - seen;
  const documents = active.reduce((sum, r) => sum + r.totals!.count, 0);
  const groups = GROUP_STYLES.filter((group) => entries.some((r) => r.item.group === group.label));
  const selectedGroup = groups.find((g) => g.key === params.filters.dailyGroup?.[0]);
  const showEmpty = params.filters.showEmpty?.[0] === "1";
  const visible = entries.filter((r) => (!selectedGroup || r.item.group === selectedGroup.label) && (
    r.item.key === selectedKey || (!r.totals || ((showEmpty || r.totals.count > 0) && (!reviewable || reviewTab === "all" || (reviewTab === "seen" ? isSeen(r) : !isSeen(r)))))
  ));
  const statCards = [
    { label: "Chứng từ cần xem", value: failures ? null : documents, hint: failures ? "Chưa tải đủ số liệu" : `trong ${formatNumber(groups.length)} nhóm`, tone: "text-fg" },
    { label: "Mục có dữ liệu", value: active.length, total: entries.length, hint: `${formatNumber(empty)} mục không có dữ liệu`, tone: "text-fg" },
    { label: "Chưa xem", value: reviewable ? unseen : null, total: active.length, progress: true, tone: "text-warning", bar: "bg-warning" },
    { label: "Đã kiểm tra", value: reviewable ? checked : null, total: active.length, progress: true, tone: "text-success", bar: "bg-success" },
  ];
  return <div className="space-y-4">
    <div aria-label="Thống kê nhanh" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {statCards.map((stat) => <div key={stat.label} className="min-w-0 rounded-md border border-border bg-surface p-4">
        <p className="text-sm text-fg-secondary">{stat.label}</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${stat.tone}`}>{formatNumber(stat.value)}{stat.total !== undefined && <span className="ml-1 text-sm font-medium text-fg-secondary">/ {formatNumber(stat.total)}{stat.label === "Mục có dữ liệu" ? " mục" : ""}</span>}</p>
        {stat.progress ? <div role="progressbar" aria-label={stat.label} aria-valuemin={0} aria-valuemax={active.length || 1} aria-valuenow={stat.value ?? undefined} aria-valuetext={stat.value === null ? "Chọn một ngày và bỏ bộ lọc để xem tiến độ" : undefined} className="mt-3 h-2 overflow-hidden rounded-full bg-hover"><div className={`h-full rounded-full ${stat.bar}`} style={{ width: `${active.length && stat.value !== null ? stat.value / active.length * 100 : 0}%` }} /></div> : <p className="mt-1 text-xs text-fg-secondary">{stat.hint}</p>}
      </div>)}
    </div>
    {failures > 0 && <p role="alert" className="text-sm text-danger">{formatNumber(failures)} mục chưa tải được. Số liệu và tiến độ chưa đầy đủ; mở mục lỗi hoặc làm mới để thử lại.</p>}
    <div className="flex flex-wrap items-center gap-3">
      {filters}
      {reviewable && <nav aria-label="Trạng thái xem nội dung" className="flex max-w-full overflow-x-auto rounded-sm border border-border bg-surface">
        {[{ key: "all", label: "Tất cả", count: active.length }, { key: "unseen", label: "Chưa xem", count: unseen }, { key: "seen", label: "Đã xem", count: seen }].map((tab) => <Link key={tab.key}
          href={buildListHref(`/?tab=daily${tab.key === "all" ? "" : `&review=${tab.key}`}`, params, { page: 1 })} aria-current={reviewTab === tab.key ? "page" : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-r border-border px-3 text-sm last:border-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${reviewTab === tab.key ? "bg-accent-soft font-semibold text-accent" : "text-fg-secondary hover:bg-hover"}`}>
          {tab.label} <span className="tabular-nums">{formatNumber(tab.count)}</span>
        </Link>)}
      </nav>}
      <div className="ml-auto"><DailyEmptyToggle basePath={base} params={params} count={empty} /></div>
    </div>
    <nav aria-label="Nhóm kiểm tra" className="flex overflow-x-auto border-b border-border">
      {[{ key: "all", label: "Tất cả", dot: "bg-accent" }, ...groups].map((group) => {
        const current = group.key === (selectedGroup?.key ?? "all");
        const count = entries.filter((r) => group.key === "all" || r.item.group === group.label).reduce((sum, r) => sum + (r.totals?.count ?? 0), 0);
        return <Link key={group.key} href={buildListHref(base, params, { filters: { dailyGroup: group.key === "all" ? [] : [group.key] } })} aria-current={current ? "page" : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${current ? "border-accent font-semibold text-fg" : "border-transparent text-fg-secondary hover:bg-hover"}`}>
          {group.key !== "all" && <span aria-hidden className={`h-2 w-2 rounded-full ${group.dot}`} />}{group.label}<span className={`rounded-full px-2 text-xs tabular-nums ${current ? "bg-accent-soft text-accent" : "bg-hover text-fg-secondary"}`}>{formatNumber(count)}</span>
        </Link>;
      })}
    </nav>
    {groups.filter((g) => visible.some((r) => r.item.group === g.label)).map((group) => <section key={group.key} aria-label={group.label} className="overflow-hidden rounded-md border border-border bg-surface">
      <div className={`flex flex-wrap items-center justify-between gap-2 border-l-4 px-4 py-3 ${group.header}`}><h2 className="text-lg font-semibold">{group.label}</h2><span className="text-xs text-fg-secondary tabular-nums">{formatNumber(entries.filter((r) => r.item.group === group.label).reduce((sum, r) => sum + (r.totals?.count ?? 0), 0))} chứng từ</span></div>
      <ul>{visible.filter((r) => r.item.group === group.label).map(({ item, totals, state }) => {
        const selected = item.key === selectedKey;
        const zero = totals?.count === 0;
        const [amountLabel, extraLabel] = dailyAmountLabels(item.key);
        return <li key={item.key} className="border-t border-border">
          <Link href={buildListHref(selected ? base : `${base}&item=${item.key}`, params, { page: 1 })} aria-expanded={selected} aria-controls={selected ? `daily-detail-${item.key}` : undefined} scroll={false}
            className={`grid min-h-11 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 p-4 hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:grid-cols-[minmax(0,1fr)_6rem_minmax(0,16rem)_1.5rem] ${zero ? "text-fg-secondary" : ""}`}>
            <span className="flex flex-wrap items-center gap-2 font-semibold">{item.label}{!zero && state && <DailyReviewBadge state={state} />}</span>
            {totals ? <><span className="text-right font-semibold tabular-nums">{formatNumber(totals.count)}<span className="block text-xs font-normal text-fg-secondary">chứng từ</span></span>
              <span className="col-span-2 col-start-1 row-start-2 text-sm font-semibold tabular-nums md:col-span-1 md:col-start-auto md:row-start-auto md:text-right">
                {zero || totals.amount === null ? "—" : <>{extraLabel && <span className="block text-xs font-normal text-fg-secondary">{amountLabel}</span>}{formatCurrency(totals.amount)}{extraLabel && totals.extra !== null && totals.extra !== "0" && <span className="block text-xs font-normal text-fg-secondary">{extraLabel}: {formatCurrency(totals.extra)}</span>}</>}
              </span></> : <span role="status" className="text-sm text-danger md:col-span-2 md:text-right">Chưa tải được · bấm để thử lại</span>}
            <ChevronRight size={18} aria-hidden className={`col-start-3 row-start-1 justify-self-end text-fg-secondary md:col-start-auto ${selected ? "rotate-90" : ""}`} />
          </Link>
          {selected && <div id={`daily-detail-${item.key}`} className="space-y-3 border-t border-dashed border-border bg-canvas p-3 md:p-4">{detail}</div>}
        </li>;
      })}</ul>
    </section>)}
    {entries.length === 0 ? <p className="rounded-md border border-border bg-surface p-6 text-center text-fg-secondary">Bạn chưa được cấp quyền xem các mục kiểm tra.</p> : visible.length === 0 && <div className="rounded-md border border-dashed border-border bg-surface p-6 text-center">
      <p className="font-medium">{reviewTab === "seen" ? "Chưa có nội dung đã xem trong ngày này." : "Không có mục nào cần xem"}</p>
      <p className="mt-1 text-sm text-fg-secondary">Thử đổi khách hàng, trạng thái hoặc tắt “Ẩn mục không có dữ liệu”.</p>
    </div>}
  </div>;
}
