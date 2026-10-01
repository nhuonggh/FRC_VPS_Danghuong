import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CircleCheck, CircleX } from "lucide-react";
import type { CloseFinding, getCloseChecklist } from "@/server/period/close-checklist";

type Checklist = Awaited<ReturnType<typeof getCloseChecklist>>;

function FindingGroup({ title, severity, findings }: { title: string; severity: CloseFinding["severity"]; findings: CloseFinding[] }) {
  const Icon = severity === "BLOCK" ? CircleX : AlertTriangle;
  const tone = severity === "BLOCK" ? "text-danger" : "text-warning";

  return (
    <section aria-labelledby={`close-${severity.toLowerCase()}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border py-3">
        <h2 id={`close-${severity.toLowerCase()}`} className="flex items-center gap-2 text-base font-semibold">
          <Icon size={18} aria-hidden className={tone} />{title}
        </h2>
        <span className={`shrink-0 text-sm font-semibold tabular ${tone}`}>
          {findings.reduce((sum, item) => sum + item.count, 0)} mục
        </span>
      </div>
      <div>
        {findings.map((finding) => (
          <article key={finding.key} className="border-b border-border py-4 last:border-b-0">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold">{finding.title}</h3>
              <span className={`shrink-0 text-sm font-semibold tabular ${finding.count > 0 ? tone : "text-fg-secondary"}`}>
                {finding.count}
              </span>
            </div>
            {finding.items.length > 0 ? (
              <ul className="mt-2 divide-y divide-border">
                {finding.items.map((item) => (
                  <li key={`${finding.key}-${item.id}`}>
                    <Link href={item.href} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:bg-hover">
                      <span className="min-w-0">
                        <span className="font-medium text-fg">{item.code}</span>
                        <span className="ml-2 text-fg-secondary">{item.description}</span>
                      </span>
                      <ArrowUpRight size={16} aria-hidden className="shrink-0 text-fg-muted" />
                    </Link>
                  </li>
                ))}
                {finding.count > finding.items.length && (
                  <li className="py-2 text-xs text-fg-secondary">Đang hiển thị {finding.items.length} trên {finding.count} mục.</li>
                )}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-fg-secondary">Không có mục cần xử lý.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export function CloseChecklist({ checklist }: { checklist: Checklist }) {
  const readyForNextStep = checklist.blockerCount === 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-semibold">Kết sổ cuối kỳ</h1>
          <p className="mt-1 text-sm text-fg-secondary">{checklist.period.name}</p>
        </div>
        <div className={`flex min-h-10 items-center gap-2 rounded-sm border px-3 text-sm font-medium ${readyForNextStep ? "border-success bg-success-soft text-success" : "border-danger bg-danger-soft text-danger"}`}>
          {readyForNextStep ? <CircleCheck size={17} aria-hidden /> : <CircleX size={17} aria-hidden />}
          {readyForNextStep ? "Không có mục chặn" : `${checklist.blockerCount} mục chặn`}
        </div>
      </header>
      <FindingGroup title="Chặn kết sổ" severity="BLOCK" findings={checklist.blockers} />
      <FindingGroup title="Cảnh báo" severity="WARN" findings={checklist.warnings} />
    </div>
  );
}