import clsx from "clsx";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Icon } from "@/components/shell/icons";
import type { Cell, Dashboard, Kpi, StatusItem, Widget } from "@/server/home/dashboard/types";
import { BarLineChart, DonutChart, RankBars } from "./charts";
import { fmt, TONE_SOFT } from "./format";

const KPI_COLS: Record<number, string> = { 1: "xl:grid-cols-1", 2: "xl:grid-cols-2", 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5", 6: "xl:grid-cols-6" };
const SPAN: Record<Widget["span"], string> = {
  3: "xl:col-span-3", 4: "xl:col-span-4", 5: "xl:col-span-5", 6: "xl:col-span-6",
  7: "md:col-span-2 xl:col-span-7", 8: "md:col-span-2 xl:col-span-8", 12: "md:col-span-2 xl:col-span-12",
};
const BADGE: Record<NonNullable<Cell["tone"]>, BadgeTone> = { success: "success", warning: "warning", danger: "danger", info: "info", neutral: "neutral" };

function KpiCard({ kpi }: { kpi: Kpi }) {
  const d = kpi.delta;
  const good = d == null ? null : kpi.deltaInverted ? d <= 0 : d >= 0;
  const body = (
    <div className="flex h-full items-center gap-3">
      <span className={clsx("flex h-12 w-12 shrink-0 items-center justify-center rounded-md", TONE_SOFT[kpi.tone])}><Icon name={kpi.icon} size={24} /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-fg-secondary" title={kpi.label}>{kpi.label}</p>
        <p className="tabular truncate text-xl font-bold" title={fmt(kpi.value, kpi.format)}>{fmt(kpi.value, kpi.format)}</p>
        <p className="flex flex-wrap items-center justify-between gap-x-2 text-xs text-fg-secondary">
          <span className="truncate">{kpi.caption ?? (d == null ? "—" : "So với kỳ trước")}</span>
          {d != null && (
            <span className={clsx("tabular inline-flex items-center gap-0.5 font-semibold", good ? "text-success" : "text-danger")} aria-label={`${d >= 0 ? "Tăng" : "Giảm"} ${Math.abs(d)}% so với kỳ trước`}>
              {d >= 0 ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />}{Math.abs(d).toLocaleString("vi-VN")}%
            </span>
          )}
        </p>
      </div>
    </div>
  );
  const cls = "min-h-[5.5rem] rounded-md border border-border bg-surface p-4";
  return kpi.href ? <Link href={kpi.href} className={clsx(cls, "block transition-shadow duration-150 ease-standard hover:shadow-md")}>{body}</Link> : <div className={cls}>{body}</div>;
}

function CellView({ c }: { c: Cell }) {
  const inner = c.tone ? <Badge tone={BADGE[c.tone]}>{c.text}</Badge> : c.text;
  return c.href ? <Link href={c.href} className="font-medium text-accent hover:underline">{inner}</Link> : <>{inner}</>;
}

function StatusGrid({ items }: { items: StatusItem[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
      {items.map((s) => (
        <li key={s.label} className="flex items-center gap-3 rounded-md border border-border bg-canvas p-3">
          <span className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-md", TONE_SOFT[s.tone])}><Icon name={s.icon} size={20} /></span>
          <span className="min-w-0">
            <span className="block truncate text-xs text-fg-secondary" title={s.label}>{s.label}</span>
            <span className="tabular block text-lg font-bold">{s.value == null ? "—" : fmt(s.value, s.format ?? "count")}</span>
            {s.caption && <span className="block truncate text-xs text-fg-muted" title={s.caption}>{s.caption}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function hasData(w: Widget): boolean {
  switch (w.kind) {
    case "bars": return [...w.bars, ...(w.line ? [w.line] : [])].some((s) => s.values.some((v) => v !== 0));
    case "donut": return w.slices.some((s) => s.value > 0);
    case "rank": return w.items.length > 0;
    case "table": return w.rows.length > 0;
    case "status": return true;
  }
}

function WidgetBody({ w }: { w: Widget }) {
  if (!hasData(w)) return <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">Chưa có dữ liệu trong khoảng thời gian này.</p>;
  switch (w.kind) {
    case "bars": return <BarLineChart labels={w.labels} bars={w.bars} line={w.line} barFormat={w.barFormat} />;
    case "donut": return <DonutChart slices={w.slices} centerLabel={w.centerLabel} centerValue={w.centerValue} format={w.format} />;
    case "rank": return <RankBars items={w.items} format={w.format} />;
    case "status": return <StatusGrid items={w.items} />;
    case "table":
      return (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold text-fg-secondary">
                {w.columns.map((c) => <th key={c.label} scope="col" className={clsx("whitespace-nowrap px-2 py-2", c.align === "right" && "text-right")}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {w.rows.map((row, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {row.map((c, j) => <td key={j} className={clsx("px-2 py-2.5", c.align === "right" && "tabular text-right", c.tone === "danger" && !c.href && "text-danger")}><CellView c={c} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** Một dashboard (KPI + lưới widget 12 cột). Server component: không JS phía client, drill-down bằng <Link>. */
export function DashboardView({ data }: { data: Dashboard }) {
  return (
    <div className="space-y-4">
      {data.kpis.length > 0 && (
        <section aria-label="Chỉ số chính" className={clsx("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3", KPI_COLS[Math.min(data.kpis.length, 6)])}>
          {data.kpis.map((k) => <KpiCard key={k.key} kpi={k} />)}
        </section>
      )}
      <section aria-label="Biểu đồ và danh sách" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
        {data.widgets.map((w) => (
          <div key={w.key} className={clsx("min-w-0 rounded-md border border-border bg-surface p-4", SPAN[w.span])} data-widget={w.key}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{w.title}</h2>
              {w.moreHref && <Link href={w.moreHref} className="shrink-0 text-sm font-medium text-accent hover:underline">Xem tất cả →</Link>}
            </div>
            <WidgetBody w={w} />
          </div>
        ))}
      </section>
      {data.notes?.map((n) => <p key={n} className="text-xs text-fg-muted">{n}</p>)}
    </div>
  );
}
