import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, EmptyState, StatCard } from "@/components/ui";
import type { BadgeTone } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { assertDebtItem, getDebtItemDetail, isDebtItemKey, type DebtDocStatus } from "@/server/reports/debt-detail";

export const dynamic = "force-dynamic";

const STATUS: Record<DebtDocStatus, { label: string; tone: BadgeTone }> = {
  OK: { label: "Khớp", tone: "success" },
  DIFF: { label: "Lệch", tone: "danger" },
  MISSING_LEDGER: { label: "Thiếu dòng sổ", tone: "danger" },
  ORPHAN: { label: "Chứng từ hủy / mất", tone: "danger" },
  OUT_OF_SCOPE: { label: "Ngoài phạm vi", tone: "warning" },
  NO_SOURCE: { label: "Theo sổ", tone: "neutral" },
};

export default async function DebtItemPage({ params, searchParams }: { params: Promise<{ item: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  if (!actor.perms.has("report.view")) redirect("/403");
  const item = (await params).item;
  if (!isDebtItemKey(item)) notFound();
  const onlyBad = (await searchParams).diff === "1";
  const detail = await getDebtItemDetail(prisma, actor, assertDebtItem(item));
  const bad = detail.rows.filter((r) => r.status !== "OK" && r.status !== "NO_SOURCE");
  const rows = onlyBad ? bad : detail.rows;
  const self = `/reports/debt-reconciliation/${item}`;
  const chip = "flex h-11 items-center rounded-sm border px-3 text-sm font-medium md:h-10";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/reports/debt-reconciliation" className="inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-fg"><ArrowLeft size={14} aria-hidden /> Đối chiếu công nợ</Link>
          <h1 className="text-xl font-semibold">{detail.label}</h1>
        </div>
        {detail.hasSource && (
          <div className="flex items-center gap-2">
            <Link href={self} className={`${chip} ${onlyBad ? "border-border hover:bg-hover" : "border-accent bg-accent-soft"}`}>Tất cả ({detail.rows.length})</Link>
            <Link href={`${self}?diff=1`} className={`${chip} ${onlyBad ? "border-accent bg-accent-soft" : "border-border hover:bg-hover"}`}>Chỉ dòng lệch ({bad.length})</Link>
          </div>
        )}
      </div>
      <section aria-label="Tổng hợp khoản mục" className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard label="Số chứng từ" value={detail.rows.length} />
        <StatCard label="Theo sổ công nợ" value={detail.ledger} money />
        <StatCard label="Theo chứng từ" value={detail.source} money />
        <StatCard label="Chênh lệch" value={detail.diff} money tone={detail.diff !== null && Number(detail.diff) !== 0 ? "danger" : "success"} />
      </section>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-surface">
        {rows.length === 0 ? <EmptyState kind="empty" title={onlyBad ? "Không có chứng từ lệch" : "Chưa có chứng từ nào"} /> : (
          <table className="w-full min-w-[820px] text-sm">
            <thead className="sticky top-0 z-10 bg-hover"><tr className="text-left text-xs font-semibold text-fg-secondary">
              <th className="px-3 py-2">Chứng từ</th><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Đối tác</th>
              <th className="px-3 py-2 text-right">Theo sổ</th><th className="px-3 py-2 text-right">Theo chứng từ</th><th className="px-3 py-2 text-right">Chênh lệch</th><th className="px-3 py-2">Trạng thái</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const isBad = r.status !== "OK" && r.status !== "NO_SOURCE";
                return (
                  <tr key={r.key} className={`border-t border-border ${isBad ? "bg-danger-soft/40" : "hover:bg-hover"}`}>
                    <td className="px-3 py-2">{r.href ? <Link href={r.href} className="inline-flex min-h-11 items-center font-medium text-accent hover:underline md:min-h-0">{r.code}</Link> : r.code}</td>
                    <td className="px-3 py-2 tabular">{r.date}</td>
                    <td className="px-3 py-2">{r.partner}</td>
                    <td className="px-3 py-2 text-right tabular">{formatCurrency(r.ledger)}</td>
                    <td className="px-3 py-2 text-right tabular">{r.source === null ? "—" : formatCurrency(r.source)}</td>
                    <td className={`px-3 py-2 text-right tabular ${isBad ? "font-semibold text-danger" : ""}`}>{r.diff === null ? "—" : formatCurrency(r.diff)}</td>
                    <td className="px-3 py-2"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>{r.note && <div className="mt-1 text-xs text-fg-secondary">{r.note}</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
