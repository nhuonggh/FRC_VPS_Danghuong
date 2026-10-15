import { notFound, redirect } from "next/navigation";
import { ExpenseForm } from "@/components/cash/ExpenseForm";
import { assertCan } from "@/lib/permissions/guard";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { getExpense, listActiveCashAccounts, listExpenseTypes } from "@/server/cash/queries";
import { DomainError } from "@/server/http/errors";

export const dynamic = "force-dynamic";

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("expense.manage");
  assertCan(actor.perms, "cash.transaction.edit_pending");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) notFound();
  const e = await getExpense(prisma, actor, id).catch((err: unknown) => { if (err instanceof DomainError && err.status === 404) return null; throw err; });
  if (!e) notFound();
  if (e.isCancelled || e.reviewStatus === "REVIEWED") redirect(`/accounting/payments/${e.paymentId}`);
  return <ExpenseForm id={id} code={e.code} today={ictYmd(new Date())} types={await listExpenseTypes(prisma)} accounts={await listActiveCashAccounts(prisma)} initial={{ expenseTypeId: e.expenseTypeId, cashAccountId: e.cashAccountId, amount: e.amount, date: e.dateYmd, note: e.note }} />;
}
