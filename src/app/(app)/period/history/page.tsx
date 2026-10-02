import { PeriodList } from "@/components/period/PeriodHistoryViews";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listPeriods } from "@/server/period/history";

export const dynamic = "force-dynamic";

export default async function PeriodHistoryPage() {
  const actor = await requireActor("period.view_closed");
  const periods = await listPeriods(prisma, actor);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Tra cứu kỳ</h1>
        <p className="mt-1 text-sm text-fg-secondary">Xem lại số liệu từng kỳ đã kết sổ — chỉ đọc. Kỳ đang làm việc luôn là kỳ đang mở.</p>
      </header>
      <PeriodList periods={periods} />
    </div>
  );
}
