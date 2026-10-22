import { CloseChecklist } from "@/components/period/CloseChecklist";
import { ClosePanel } from "@/components/period/ClosePanel";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { previewClose } from "@/server/closing/service";
import { getCloseChecklist } from "@/server/period/close-checklist";

export const dynamic = "force-dynamic";

export default async function PeriodClosePage() {
  const actor = await requireActor("period.close");
  const checklist = await getCloseChecklist(prisma);
  // Số xem trước chỉ tính khi không còn mục chặn (kết sổ chưa được phép thì khỏi tốn truy vấn)
  const preview = checklist.blockerCount === 0 ? await previewClose(prisma, actor) : null;
  return (
    <div className="w-full space-y-4">
      <CloseChecklist checklist={checklist} />
      <ClosePanel periodName={checklist.period.name} blockerCount={checklist.blockerCount} warningCount={checklist.warningCount} preview={preview?.preview ?? null} cashNames={await cashNames(preview?.preview.cash.map((c) => c.accountId) ?? [])} />
    </div>
  );
}

async function cashNames(ids: number[]): Promise<Record<number, string>> {
  if (ids.length === 0) return {};
  const rows = await prisma.cashAccount.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}
