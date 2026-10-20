import { CashBook } from "@/components/cash/CashBook";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listCashBook } from "@/server/cash/queries";

export const dynamic = "force-dynamic";

export default async function CashbookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("cashbook.view");
  const sp = await searchParams;
  const raw = Array.isArray(sp.account) ? sp.account[0] : sp.account;
  const account = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  const book = await listCashBook(prisma, actor, "CASH", account, parseListParams(sp, []));
  return <CashBook book={book} type="CASH" base="/accounting/cashbook" canClose={actor.perms.has("cash.close")} canReopen={actor.perms.has("cash.close.reopen")} canHandOver={actor.perms.has("payment.manage") && actor.perms.has("cash.transaction.create")} nowIso={new Date(Date.now() + 7 * 3600_000).toISOString()} />;
}
