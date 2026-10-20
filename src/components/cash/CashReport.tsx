import Link from "next/link";
import { EmptyState, Badge } from "@/components/ui";
import { QuickTimeFilter } from "@/components/ui/QuickTimeFilter";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { CashReportDTO } from "@/server/cash/report";

/** Báo cáo quỹ tiền mặt: theo ngày (đầu ngày tự tính từ cuối ngày trước) và theo người kiểm tra. */
export function CashReport({ report, params, base }: { report: CashReportDTO; params: ListParams; base: string }) {
  const sel = report.selectedId;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Báo cáo quỹ tiền mặt</h1>
        <p className="text-xs text-fg-secondary">Kỳ {report.periodName}. Đầu ngày = cuối ngày trước. Ngày chưa chốt vẫn nhập phiếu và bổ sung quỹ bình thường; chốt quỹ lùi cho ngày hôm trước ở Sổ quỹ tiền mặt.</p>
      </div>
      {report.accounts.length === 0 ? <EmptyState kind="empty" title="Chưa có quỹ tiền mặt" description="Tạo ở Hệ thống → Cài đặt danh mục." /> : (
        <>
          <nav aria-label="Chọn quỹ" className="flex flex-wrap gap-2">
            {report.accounts.map((a) => (
              <Link key={a.id} href={buildListHref(`${base}?account=${a.id}`, params, { page: 1 })} aria-current={a.id === sel ? "true" : undefined} className={`rounded-sm border px-3 py-2 text-sm ${a.id === sel ? "border-accent bg-accent-soft" : "border-border hover:bg-hover"}`}><strong>{a.name}</strong></Link>
            ))}
          </nav>
          <QuickTimeFilter basePath={`${base}?account=${sel}`} params={params} />
          {report.unclosedDays > 0 && <p role="status" className="rounded-sm border border-warning bg-warning-soft px-3 py-2 text-sm">Có {report.unclosedDays} ngày đã qua nhưng chưa chốt quỹ.</p>}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Theo ngày — {report.accountName}</h2>
            <div className="overflow-x-auto rounded-md border border-border bg-surface">
              {report.days.length === 0 ? <EmptyState kind="empty" title="Chưa có phát sinh trong khoảng này" /> : (
                <table className="w-full min-w-[960px] text-sm">
                  <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Ngày</th><th className="px-3 py-2 text-right">Đầu ngày</th><th className="px-3 py-2 text-right">Bổ sung quỹ</th><th className="px-3 py-2 text-right">Tổng thu</th><th className="px-3 py-2 text-right">Tổng chi</th><th className="px-3 py-2 text-right">Cuối ngày</th><th className="px-3 py-2 text-right">Chờ kiểm</th><th className="px-3 py-2">Chốt quỹ</th></tr></thead>
                  <tbody>
                    {report.days.map((d) => (
                      <tr key={d.ymd} className="border-t border-border">
                        <td className="px-3 py-2 whitespace-nowrap">{formatDate(`${d.ymd}T00:00:00+07:00`)}</td>
                        <td className="px-3 py-2 text-right tabular">{formatCurrency(d.opening)}</td>
                        <td className="px-3 py-2 text-right tabular">{Number(d.topUp) ? formatCurrency(d.topUp) : ""}</td>
                        <td className="px-3 py-2 text-right tabular">{Number(d.in) ? formatCurrency(d.in) : ""}</td>
                        <td className="px-3 py-2 text-right tabular">{Number(d.out) ? formatCurrency(d.out) : ""}</td>
                        <td className="px-3 py-2 text-right tabular font-medium">{formatCurrency(d.closing)}</td>
                        <td className="px-3 py-2 text-right tabular">{d.pendingCount || ""}</td>
                        <td className="px-3 py-2">{d.close ? <span className="flex flex-wrap items-center gap-1"><Badge tone={Number(d.close.diff) === 0 ? "success" : "warning"}>{Number(d.close.diff) === 0 ? "Khớp" : `Chênh ${formatCurrency(d.close.diff)}`}</Badge><span className="text-xs text-fg-muted">{d.close.byName} · {formatDateTime(d.close.at)}</span></span> : <Badge tone="neutral">Chưa chốt</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Theo người kiểm tra</h2>
            <div className="overflow-x-auto rounded-md border border-border bg-surface">
              {report.reviewers.length === 0 ? <EmptyState kind="empty" title="Chưa có phiếu trong khoảng này" /> : (
                <table className="w-full min-w-[720px] text-sm">
                  <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Người kiểm tra</th><th className="px-3 py-2 text-right">Số phiếu</th><th className="px-3 py-2 text-right">Thu</th><th className="px-3 py-2 text-right">Chi</th><th className="px-3 py-2 text-right">Lần chốt quỹ</th><th className="px-3 py-2 text-right">Chênh lệch chốt</th></tr></thead>
                  <tbody>
                    {report.reviewers.map((r) => (
                      <tr key={r.reviewerId ?? "none"} className="border-t border-border">
                        <td className="px-3 py-2">{r.reviewerId === null ? <span className="text-warning">{r.name}</span> : r.name}</td>
                        <td className="px-3 py-2 text-right tabular">{r.vouchers}</td>
                        <td className="px-3 py-2 text-right tabular">{Number(r.in) ? formatCurrency(r.in) : ""}</td>
                        <td className="px-3 py-2 text-right tabular">{Number(r.out) ? formatCurrency(r.out) : ""}</td>
                        <td className="px-3 py-2 text-right tabular">{r.closes || ""}</td>
                        <td className="px-3 py-2 text-right tabular">{r.closes ? formatCurrency(r.closeDiff) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <p className="text-xs text-fg-muted">Người kiểm tra = người bấm “Kiểm tra” phiếu; lần chốt quỹ tính theo người chốt. Phiếu chưa kiểm hoặc bị trả lại nằm ở dòng “Chưa kiểm tra”.</p>
          </section>
        </>
      )}
    </div>
  );
}
