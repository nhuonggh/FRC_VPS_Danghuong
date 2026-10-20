import { ExpenseForm } from "@/components/cash/ExpenseForm";
import { assertCan } from "@/lib/permissions/guard";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { listActiveCashAccounts, listExpenseTypes } from "@/server/cash/queries";

export const dynamic = "force-dynamic";

export default async function NewExpensePage() {
  const actor = await requireActor("expense.manage");
  assertCan(actor.perms, "cash.transaction.create");
  return <ExpenseForm people={(await prisma.user.findMany({ where: { isLocked: false }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } })).map(u => ({ value: u.id, label: u.fullName }))} today={ictYmd(new Date())} types={await listExpenseTypes(prisma)} accounts={await listActiveCashAccounts(prisma)} />;
}
