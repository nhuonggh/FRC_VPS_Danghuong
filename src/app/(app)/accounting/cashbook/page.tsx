import { CashBook } from "@/components/cash/CashBook";
import { prisma } from "@/lib/prisma";
import { parseTimedListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { CASHBOOK_FILTER_KEYS, listCashBook } from "@/server/cash/queries";

export const dynamic = "force-dynamic";

export default async function CashbookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("cashbook.view");
  const sp = await searchParams;
  const raw = Array.isArray(sp.account) ? sp.account[0] : sp.account;
  const account = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  const params = parseTimedListParams(sp, CASHBOOK_FILTER_KEYS);
  const book = await listCashBook(prisma, actor, "CASH", account, params);
  return <CashBook book={book} params={params} type="CASH" base="/accounting/cashbook" canClose={actor.perms.has("cash.close")} canReopen={actor.perms.has("cash.close.reopen")} canReview={actor.perms.has("cash.review")} canHandOver={actor.perms.has("payment.manage") && actor.perms.has("cash.transaction.create")} nowIso={new Date(Date.now() + 7 * 3600_000).toISOString()} />;
}
