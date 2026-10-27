import { CashBook } from "@/components/cash/CashBook";
import { prisma } from "@/lib/prisma";
import { parseTimedListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { CASHBOOK_FILTER_KEYS, listCashBook } from "@/server/cash/queries";

export const dynamic = "force-dynamic";

export default async function BankbookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("cashbook.view");
  const sp = await searchParams;
  const raw = Array.isArray(sp.account) ? sp.account[0] : sp.account;
  const account = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  const params = parseTimedListParams(sp, CASHBOOK_FILTER_KEYS);
  const book = await listCashBook(prisma, actor, "BANK", account, params);
  return <CashBook book={book} params={params} type="BANK" base="/accounting/bankbook" canClose={actor.perms.has("cash.close")} canReopen={actor.perms.has("cash.close.reopen")} canReview={actor.perms.has("cash.review")} nowIso={new Date(Date.now() + 7 * 3600_000).toISOString()} />;
}
