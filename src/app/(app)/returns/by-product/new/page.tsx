import { ReturnByProductForm } from "@/components/returns/ReturnByProductForm";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function NewReturnPage() {
  const actor = await requireActor("return.manage");
  const canRefund = actor.perms.has("payment.manage") && actor.perms.has("cash.transaction.create");
  const accounts = canRefund ? await prisma.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }) : [];
  return <ReturnByProductForm mode="BY_PRODUCT" today={ictYmd(new Date())} refundAccounts={canRefund ? accounts.map((a) => ({ value: a.id, label: a.name, type: a.type as "CASH" | "BANK" })) : undefined} />;
}
