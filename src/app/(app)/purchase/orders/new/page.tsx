import { redirect } from "next/navigation";
import { PurchaseNewForm } from "@/components/purchase/PurchaseNewForm";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";

export const dynamic = "force-dynamic";

export default async function NewPurchasePage() {
  const actor = await requireActor("purchase.create");
  if (!actor.perms.has("purchase_price.view")) redirect("/403");
  const canCreateSupplier = actor.perms.has("partner.manage");
  const canPay = actor.perms.has("payment.manage") && actor.perms.has("cash.transaction.create");
  const [groups, accounts] = await Promise.all([
    canCreateSupplier ? listActiveOptions(prisma, "partner-groups") : Promise.resolve([]),
    canPay ? prisma.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }) : Promise.resolve([]),
  ]);
  return <PurchaseNewForm today={ictYmd(new Date())} supplierGroups={canCreateSupplier ? groups : undefined}
    payAccounts={canPay ? accounts.map((a) => ({ value: a.id, label: a.name, type: a.type as "CASH" | "BANK" })) : undefined} />;
}
