import { notFound, redirect } from "next/navigation";
import { VoucherForm } from "@/components/cash/VoucherForm";
import { assertCan } from "@/lib/permissions/guard";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { getVoucher, listActiveCashAccounts } from "@/server/cash/queries";
import { DomainError } from "@/server/http/errors";

export const dynamic = "force-dynamic";

export default async function EditPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("payment.manage");
  assertCan(actor.perms, "cash.transaction.edit_pending");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) notFound();
  const v = await getVoucher(prisma, actor, "PAYMENT", id).catch((e: unknown) => { if (e instanceof DomainError && e.status === 404) return null; throw e; });
  if (!v) notFound();
  if (v.isCancelled || v.reviewStatus === "REVIEWED" || ["COC", "CHI_PHI", "TAT_TOAN_CK"].includes(v.type)) redirect("/accounting/payments/" + id);
  return <VoucherForm doc="PAYMENT" id={id} code={v.code} today={ictYmd(new Date())} accounts={await listActiveCashAccounts(prisma)}
    initial={{ type: v.type, partner: v.partnerId ? { value: v.partnerId, label: v.partnerName ?? "" } : null, order: v.orderId ? { value: v.orderId, label: v.orderCode ?? "" } : null, cashAccountId: v.cashAccountId, amount: v.amount, date: v.dateYmd, note: v.note ?? "" }} />;
}
