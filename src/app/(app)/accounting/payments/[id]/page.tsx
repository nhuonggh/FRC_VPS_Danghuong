import { notFound } from "next/navigation";
import { canPrintDoc } from "@/server/print/types";
import { VoucherDetail } from "@/components/cash/VoucherDetail";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { getVoucher, listActiveCashAccounts } from "@/server/cash/queries";
import { DomainError } from "@/server/http/errors";

export const dynamic = "force-dynamic";

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("payment.manage");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) notFound();
  const v = await getVoucher(prisma, actor, "PAYMENT", id).catch((e: unknown) => { if (e instanceof DomainError && e.status === 404) return null; throw e; });
  if (!v) notFound();
  const p = actor.perms;
  return <VoucherDetail v={v} accounts={await listActiveCashAccounts(prisma)} perms={{ canEdit: p.has("cash.transaction.edit_pending"), canReview: p.has("cash.review"), canRequestAdjust: p.has("cash.adjust.request"), canApprove: p.has("cash.adjust.approve"), canPrint: canPrintDoc(p, "PAYMENT") }} />;
}
