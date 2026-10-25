import { ExpenseList } from "@/components/cash/ExpenseList";
import { prisma } from "@/lib/prisma";
import { buildExportHref, parseTimedListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { EXPENSE_FILTER_KEYS, listExpenses, listExpenseTypes } from "@/server/cash/queries";

export const dynamic = "force-dynamic";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("expense.manage");
  const params = parseTimedListParams(await searchParams, EXPENSE_FILTER_KEYS);
  const [data, types] = await Promise.all([listExpenses(prisma, actor, params), listExpenseTypes(prisma)]);
  return <ExpenseList rows={data.rows} total={data.total} summary={data.summary} params={params} types={types} canCreate={actor.perms.has("cash.transaction.create")} exportHref={buildExportHref("/api/expenses/export", params)} />;
}
