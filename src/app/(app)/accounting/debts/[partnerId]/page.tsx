import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PaginationFooter, StatCard } from "@/components/ui";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { getDebtDetail } from "@/server/debt/queries";
import { DomainError } from "@/server/http/errors";

export const dynamic = "force-dynamic";

/** Chi tiết công nợ một đối tác (63): số dư chạy tính khi đọc + đối chiếu tổng. */
export default async function DebtDetailPage({ params, searchParams }: { params: Promise<{ partnerId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("debt.view");
  const raw = (await params).partnerId;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0 || Number(raw) > 2_147_483_647) notFound();
  const lp = parseListParams(await searchParams, []);
  const d = await getDebtDetail(prisma, actor, Number(raw), lp).catch((e) => {
    if (e instanceof DomainError && e.status === 404) notFound();
    throw e;
  });
  const base = `/accounting/debts/${d.partner.id}`;
  const canAdjust = actor.perms.has("debt.adjust");
  return (
    <div className="space-y-4">
      <Link href="/accounting/debts" className="text-sm text-accent hover:underline">← Quay lại công nợ tổng hợp</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{d.partner.name}</h1>
          <p className="text-sm text-fg-secondary"><span className="font-mono">{d.partner.code}</span> · {d.partner.groupName} · {[d.partner.isCustomer ? "Khách" : null, d.partner.isSupplier ? "NCC" : null].filter(Boolean).join(" / ")}</p>
        </div>
        {canAdjust && <Link href={`/accounting/debt-adjustments/new?partnerId=${d.partner.id}`} className="flex h-10 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover">Điều chỉnh công nợ</Link>}
      </div>
      <div className="flex flex-wrap gap-3">
        <StatCard label="Đầu kỳ" value={Number(d.opening)} />
        <StatCard label="Phát sinh nợ" value={Number(d.debit)} tone="info" />
        <StatCard label="Phát sinh có" value={Number(d.credit)} tone="success" />
        <StatCard label={Number(d.balance) < 0 ? "Số dư (phải trả)" : "Số dư (phải thu)"} value={Number(d.balance)} tone={Number(d.balance) < 0 ? "warning" : "danger"} />
        <StatCard label="CK tích lũy còn" value={Number(d.discountBalance)} tone="success" />
      </div>
      {!d.reconciled && <p role="alert" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">Số dư cộng dồn không khớp tổng — báo quản trị hệ thống.</p>}
      {d.total === 0 ? <EmptyState kind="empty" title="Chưa có phát sinh trong kỳ" /> : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[680px] text-sm">
            <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
              <th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Chứng từ</th><th className="px-3 py-2 text-right">Nợ (tăng)</th><th className="px-3 py-2 text-right">Có (giảm)</th><th className="px-3 py-2 text-right">Số dư sau</th>
            </tr></thead>
            <tbody>
              {d.entries.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-3 py-2">{formatDateTime(e.at)}</td>
                  <td className="px-3 py-2">{e.docLabel} {e.docCode && (e.docHref ? <Link href={e.docHref} className="font-mono text-xs text-accent hover:underline">{e.docCode}</Link> : <span className="font-mono text-xs">{e.docCode}</span>)}</td>
                  <td className="px-3 py-2 text-right tabular">{Number(e.debit) > 0 ? formatCurrency(e.debit) : ""}</td>
                  <td className="px-3 py-2 text-right tabular">{Number(e.credit) > 0 ? formatCurrency(e.credit) : ""}</td>
                  <td className="px-3 py-2 text-right tabular font-medium">{formatCurrency(e.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationFooter total={d.total} page={lp.page} pageSize={lp.pageSize} buildHref={(page) => buildListHref(base, lp, page)} />
        </div>
      )}
    </div>
  );
}
