import { VoucherForm } from "@/components/cash/VoucherForm";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { listActiveCashAccounts } from "@/server/cash/queries";
import { assertCan } from "@/lib/permissions/guard";

export const dynamic = "force-dynamic";

export default async function NewReceiptPage() {
  const actor = await requireActor("receipt.manage");
  assertCan(actor.perms, "cash.transaction.create");
  return <VoucherForm doc="RECEIPT" today={ictYmd(new Date())} accounts={await listActiveCashAccounts(prisma)} />;
}
