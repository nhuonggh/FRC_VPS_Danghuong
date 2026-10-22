import Link from "next/link";
import { StatCard } from "@/components/ui/StatCard";
import { formatNumber } from "@/lib/format";
import { AlertTriangle, ArrowUpRight, CircleCheck, CircleX } from "lucide-react";
import type { CloseFinding, getCloseChecklist } from "@/server/period/close-checklist";

type Checklist = Awaited<ReturnType<typeof getCloseChecklist>>;

function FindingGroup({ title, severity, findings }: { title: string; severity: CloseFinding["severity"]; findings: CloseFinding[] }) {
  const Icon = severity === "BLOCK" ? CircleX : AlertTriangle;
  const tone = severity === "BLOCK" ? "text-danger" : "text-warning";

  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface" aria-labelledby={`close-${severity.toLowerCase()}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border bg-hover px-4 py-3">
        <h2 id={`close-${severity.toLowerCase()}`} className="flex items-center gap-2 text-base font-semibold">
          <Icon size={18} aria-hidden className={tone} />{title}
        </h2>
        <span className={`shrink-0 text-sm font-semibold tabular ${tone}`}>
          {formatNumber(findings.reduce((sum, item) => sum + item.count, 0))} mục
        </span>
      </div>
      <div>
        {findings.map((finding) => (
          <article key={finding.key} className="border-b border-border px-4 py-3 last:border-b-0">
            <div className="flex items-start justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                {finding.count === 0
                  ? <CircleCheck size={16} aria-hidden className="shrink-0 text-success" />
                  : <Icon size={16} aria-hidden className={`shrink-0 ${tone}`} />}
                {finding.title}
              </h3>
              <span className={`shrink-0 text-sm font-semibold tabular ${finding.count > 0 ? tone : "text-success"}`}>
                {formatNumber(finding.count)}
              </span>
            </div>
            {finding.count > 0 && <p className="mt-1 text-xs text-fg-secondary">{finding.hint}</p>}
            {finding.items.length > 0 ? (
              <details open className="mt-3 overflow-hidden rounded-sm border border-border">
                <summary className="min-h-11 cursor-pointer bg-hover px-3 py-3 text-xs font-medium text-fg-secondary focus-visible:outline focus-visible:outline-accent">Chi tiết cần xử lý · {formatNumber(finding.count)} mục</summary>
              <ul className="divide-y divide-border">
                {finding.items.map((item, index) => (
                  <li key={`${finding.key}-${item.id}-${index}`}>
                    <Link href={item.href} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-hover focus-visible:outline focus-visible:outline-accent">
                      <span className="min-w-0">
                        <span className="font-medium text-fg">{item.code}</span>
                        <span className="mt-1 block break-words text-fg-secondary md:ml-2 md:mt-0 md:inline">{item.description}</span>
                      </span>
                      <ArrowUpRight size={16} aria-hidden className="shrink-0 text-fg-muted" />
                    </Link>
                  </li>
                ))}
                {finding.count > finding.items.length && (
                  <li className="py-2 text-xs text-fg-secondary">Đang hiển thị {finding.items.length} trên {finding.count} mục.</li>
                )}
              </ul>
              </details>
            ) : finding.count === 0 ? (
              <p className="mt-1 text-sm text-success">Đạt — không có mục cần xử lý.</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export function CloseChecklist({ checklist }: { checklist: Checklist }) {
  const readyForNextStep = checklist.blockerCount === 0;

  return (
    <div className="w-full space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Kết sổ cuối kỳ</h1>
          <p className="mt-1 text-sm text-fg-secondary">{checklist.period.name}</p>
        </div>
        <div className={`flex min-h-10 items-center gap-2 rounded-sm border px-3 text-sm font-medium ${readyForNextStep ? "border-success bg-success-soft text-success" : "border-danger bg-danger-soft text-danger"}`}>
          {readyForNextStep ? <CircleCheck size={17} aria-hidden /> : <CircleX size={17} aria-hidden />}
          {readyForNextStep ? "Không có mục chặn" : `${checklist.blockerCount} mục chặn`}
        </div>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Điều kiện kiểm tra" value={checklist.blockers.length + checklist.warnings.length} />
        <StatCard label="Điều kiện đã đạt" value={[...checklist.blockers, ...checklist.warnings].filter((f) => f.count === 0).length} tone="success" />
        <StatCard label="Mục chặn kết sổ" value={checklist.blockerCount} tone="danger" />
        <StatCard label="Mục cảnh báo" value={checklist.warningCount} tone="warning" />
      </div>
      <FindingGroup title="Chặn kết sổ" severity="BLOCK" findings={checklist.blockers} />
      <FindingGroup title="Cảnh báo" severity="WARN" findings={checklist.warnings} />
    </div>
  );
}
