import { PeriodList } from "@/components/period/PeriodHistoryViews";
import { ListPageLayout, StatCard } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listPeriods } from "@/server/period/history";

export const dynamic = "force-dynamic";

export default async function PeriodHistoryPage() {
  const actor = await requireActor("period.view_closed");
  const periods = await listPeriods(prisma, actor);
  return (
    <ListPageLayout title="Tra cứu kỳ"
      description="Xem lại số liệu từng kỳ đã kết sổ — chỉ đọc. Kỳ đang làm việc luôn là kỳ đang mở."
      statsClassName="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
      stats={<>
        <StatCard label="Tổng số kỳ" value={periods.length} />
        <StatCard label="Kỳ đang mở" value={periods.filter((p) => p.status === "OPEN").length} tone="success" />
        <StatCard label="Kỳ đã kết sổ" value={periods.filter((p) => p.status === "CLOSED").length} tone="info" />
        <StatCard label="Chứng từ trong các kỳ" value={periods.reduce((sum, p) => sum + p.counts.orders + p.counts.purchases + p.counts.receipts + p.counts.payments, 0)} />
      </>}
      footer={<div className="border-t border-border px-4 py-3 text-sm text-fg-secondary">Tổng: <span className="tabular font-medium text-fg">{formatNumber(periods.length)}</span> kỳ</div>}
    >
      <PeriodList periods={periods} />
    </ListPageLayout>
  );
}
