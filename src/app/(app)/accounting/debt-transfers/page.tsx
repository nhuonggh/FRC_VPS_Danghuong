import { Plus } from "lucide-react";
import Link from "next/link";
import { CancelDebtButton } from "@/components/debt/CancelDebtButton";
import { Badge, EmptyState, ListPageLayout, PaginationFooter, SearchBox } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listTransfers } from "@/server/debt/queries";

export const dynamic = "force-dynamic";
const BASE = "/accounting/debt-transfers";

export default async function DebtTransfersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("debt.adjust");
  const params = parseListParams(await searchParams, []);
  const { rows, total } = await listTransfers(prisma, actor, params);
  return (
    <ListPageLayout
      title="Gộp / chuyển công nợ"
      actions={<Link href={`${BASE}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden />Gộp / chuyển</Link>}
      filters={<SearchBox basePath={BASE} params={params} placeholder="Tìm mã phiếu, đối tác…" />}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => buildListHref(BASE, params, page)} />}
    >
      {total === 0 ? <EmptyState kind={params.q ? "no-result" : "empty"} title={params.q ? "Không tìm thấy phiếu phù hợp" : "Chưa có phiếu gộp/chuyển công nợ"} /> : (
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
            <th className="px-3 py-2">Mã</th><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Hình thức</th><th className="px-3 py-2">Từ</th><th className="px-3 py-2">Sang</th><th className="px-3 py-2 text-right">Số tiền</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="px-3 py-2 font-mono text-xs">{r.code}{r.isCancelled && <> <Badge tone="danger">Đã hủy</Badge></>}</td>
                <td className="px-3 py-2">{formatDate(r.at)}</td>
                <td className="px-3 py-2">{r.kind === "MERGE" ? "Gộp mã" : "Chuyển"}</td>
                <td className="px-3 py-2">{r.fromName}<span className="block text-xs text-fg-muted">{r.fromCode}</span></td>
                <td className="px-3 py-2">{r.toName}<span className="block text-xs text-fg-muted">{r.toCode}</span></td>
                <td className="px-3 py-2 text-right tabular">{formatCurrency(String(Math.abs(Number(r.amount))))}{Number(r.discountMoved) > 0 && <span className="block text-xs text-fg-muted">+ CK tích lũy {formatCurrency(r.discountMoved)}</span>}</td>
                <td className="px-3 py-2 text-right">{!r.isCancelled && <CancelDebtButton kind="transfers" id={r.id} code={r.code} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ListPageLayout>
  );
}
