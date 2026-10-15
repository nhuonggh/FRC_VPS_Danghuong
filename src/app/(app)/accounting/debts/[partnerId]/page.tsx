import { PrintButton } from "@/components/print/PrintButton";
import { canPrintDoc } from "@/server/print/types";
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
  // Sổ lưu theo quy ước kế toán (+ khách nợ mình, − mình nợ NCC). NCC thuần: đảo dấu + đổi nhãn để đọc là "mình còn nợ bao nhiêu".
  const supplierOnly = d.partner.isSupplier && !d.partner.isCustomer;
  const both = d.partner.isSupplier && d.partner.isCustomer;
  const sgn = supplierOnly ? -1 : 1;
  const inc = supplierOnly ? Number(d.credit) : Number(d.debit);
  const dec = supplierOnly ? Number(d.debit) : Number(d.credit);
  const bal = Number(d.balance) * sgn;
  const cols = supplierOnly
    ? { inc: "Nợ NCC tăng", dec: "Đã trả / giảm nợ", run: "Còn nợ NCC", hint: "Mua hàng làm tăng số nợ NCC; trả tiền (phiếu chi) làm giảm. Số dương = mình còn nợ NCC; số âm = đã trả dư (NCC nợ lại mình)." }
    : both
      ? { inc: "Phải thu tăng", dec: "Phải thu giảm", run: "Số dư sau", hint: "Số dương = đối tác nợ mình; số âm = mình nợ đối tác." }
      : { inc: "Khách nợ thêm", dec: "Khách trả / giảm nợ", run: "Khách còn nợ", hint: "Bán hàng làm tăng nợ khách; thu tiền, trả hàng, chiết khấu làm giảm. Số âm = khách trả dư (mình nợ lại khách)." };
  const incOf = (e: { debit: unknown; credit: unknown }) => Number(supplierOnly ? e.credit : e.debit);
  const decOf = (e: { debit: unknown; credit: unknown }) => Number(supplierOnly ? e.debit : e.credit);
  return (
    <div className="space-y-4">
      <Link href="/accounting/debts" className="text-sm text-accent hover:underline">← Quay lại công nợ tổng hợp</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{d.partner.name}</h1>
          <p className="text-sm text-fg-secondary"><span className="font-mono">{d.partner.code}</span> · {d.partner.groupName} · {[d.partner.isCustomer ? "Khách" : null, d.partner.isSupplier ? "NCC" : null].filter(Boolean).join(" / ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {canPrintDoc(actor.perms, "DEBT_STATEMENT") && <PrintButton docType="DEBT_STATEMENT" docId={d.partner.id} label="In đối chiếu công nợ" />}
        {canAdjust && <Link href={`/accounting/debt-adjustments/new?partnerId=${d.partner.id}`} className="flex h-10 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover">Điều chỉnh công nợ</Link>}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <StatCard label={supplierOnly ? "Nợ NCC đầu kỳ" : "Đầu kỳ"} value={Number(d.opening) * sgn} />
        <StatCard label={cols.inc} value={inc} tone="info" />
        <StatCard label={cols.dec} value={dec} tone="success" />
        <StatCard label={supplierOnly ? (bal < 0 ? "NCC nợ lại mình" : "Còn nợ NCC") : both ? (bal < 0 ? "Số dư (mình nợ)" : "Số dư (đối tác nợ)") : (bal < 0 ? "Mình nợ khách" : "Khách còn nợ")} value={supplierOnly || both ? Math.abs(bal) : bal} tone={bal > 0 ? "danger" : "warning"} />
        <StatCard label="CK tích lũy còn" value={Number(d.discountBalance)} tone={Number(d.discountBalance) < 0 ? "danger" : "success"} href={d.partner.isCustomer ? `/accounting/discounts/${d.partner.id}` : undefined} />
      </div>
      <p className="text-sm text-fg-secondary">{cols.hint}</p>
      {!d.reconciled && <p role="alert" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">Số dư cộng dồn không khớp tổng — báo quản trị hệ thống.</p>}
      {d.total === 0 ? <EmptyState kind="empty" title="Chưa có phát sinh trong kỳ" /> : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[680px] text-sm">
            <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
              <th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Chứng từ</th><th className="px-3 py-2 text-right">{cols.inc}</th><th className="px-3 py-2 text-right">{cols.dec}</th><th className="px-3 py-2 text-right">{cols.run}</th>
            </tr></thead>
            <tbody>
              {d.entries.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-3 py-2">{formatDateTime(e.at)}</td>
                  <td className="px-3 py-2">{e.docLabel} {e.docCode && (e.docHref ? <Link href={e.docHref} className="font-mono text-xs text-accent hover:underline">{e.docCode}</Link> : <span className="font-mono text-xs">{e.docCode}</span>)}</td>
                  <td className="px-3 py-2 text-right tabular">{incOf(e) > 0 ? formatCurrency(incOf(e)) : ""}</td>
                  <td className="px-3 py-2 text-right tabular">{decOf(e) > 0 ? formatCurrency(decOf(e)) : ""}</td>
                  <td className="px-3 py-2 text-right tabular font-medium">{formatCurrency(sgn * Number(e.running))}</td>
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
