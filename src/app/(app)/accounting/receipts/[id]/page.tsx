import { notFound } from "next/navigation";
import { canPrintDoc } from "@/server/print/types";
import { VoucherDetail } from "@/components/cash/VoucherDetail";
import { prisma } from "@/lib/prisma";
import { ClosedPeriodBanner } from "@/components/period/PeriodHistoryViews";
import { requireActor } from "@/server/auth/session";
import { closedPeriodOf } from "@/server/period/doc-period";
import { getVoucher, listActiveCashAccounts } from "@/server/cash/queries";
import { DomainError } from "@/server/http/errors";

export const dynamic = "force-dynamic";

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("receipt.manage");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) notFound();
  const v = await getVoucher(prisma, actor, "RECEIPT", id).catch((e: unknown) => { if (e instanceof DomainError && e.status === 404) return null; throw e; });
  if (!v) notFound();
  const p = actor.perms;
  const closed = await closedPeriodOf(prisma, "receipt", id);
  return (
    <>
      {closed && <div className="mb-4"><ClosedPeriodBanner periodName={closed.name} closedAt={closed.closedAt} note="Hậu kiểm vẫn làm được; sửa/hủy/điều chỉnh thì lập chứng từ mới ở kỳ đang mở." /></div>}
      <VoucherDetail v={v} accounts={await listActiveCashAccounts(prisma)} perms={{ canEdit: !closed && p.has("cash.transaction.edit_pending"), canReview: p.has("cash.review"), canRequestAdjust: !closed && p.has("cash.adjust.request"), canApprove: !closed && p.has("cash.adjust.approve"), canPrint: canPrintDoc(p, "RECEIPT") }} />
    </>
  );
}
