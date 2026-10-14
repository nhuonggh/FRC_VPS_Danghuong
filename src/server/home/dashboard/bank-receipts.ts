import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { ictYmd } from "@/lib/time";
import type { BankReceiptsOverview } from "./types";
import type { DashRange, Db } from "./common";

export function bankRangeQuery(range: DashRange): URLSearchParams {
  return new URLSearchParams({ timePreset: "custom", timeStart: ictYmd(range.start), timeEnd: ictYmd(new Date(range.end.getTime() - 1)) });
}

export async function loadBankReceipts(db: Db, actor: Actor, range: DashRange, account?: string): Promise<BankReceiptsOverview | undefined> {
  const book = actor.perms.has("cashbook.view"), receipts = actor.perms.has("receipt.manage"), review = actor.perms.has("cash.review");
  if (!book && !receipts) return undefined;
  const at = { gte: range.start, lt: range.end };
  // Include disabled accounts with historical receipts in the selected range.
  const accounts = await db.cashAccount.findMany({
    where: { type: "BANK", OR: [{ isActive: true }, { receipts: { some: { isCancelled: false, at } } }] },
    orderBy: { name: "asc" }, select: { id: true, name: true, bankNo: true },
  });
  const id = account && /^\d{1,9}$/.test(account) ? Number(account) : null;
  const selectedAccount = accounts.some((a) => a.id === id) ? id : null;
  const where = { isCancelled: false, at, cashAccountId: { in: accounts.filter((a) => selectedAccount === null || a.id === selectedAccount).map((a) => a.id) } };
  const [groups, tasks] = await Promise.all([
    db.receipt.groupBy({ by: ["cashAccountId", "reviewStatus"], where: { ...where, cashAccountId: { in: accounts.map((a) => a.id) } }, _sum: { amount: true }, _count: { _all: true } }),
    db.receipt.findMany({
      where: { ...where, reviewStatus: { in: ["RETURNED", "PENDING_REVIEW"] } },
      // RETURNED is last in the enum; prioritize returned receipts, then oldest first.
      orderBy: [{ reviewStatus: "desc" }, { at: "asc" }, { id: "asc" }], take: 5,
      select: { id: true, code: true, at: true, amount: true, reviewStatus: true, partner: { select: { name: true } }, cashAccount: { select: { id: true, name: true } } },
    }),
  ]);
  const href = (path: string, accountId?: number, extra: Record<string, string> = {}) => {
    const q = bankRangeQuery(range);
    if (accountId) q.set("account", String(accountId));
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return `${path}?${q}`;
  };
  const allRows = accounts.map((a) => {
    const parts = groups.filter((g) => g.cashAccountId === a.id);
    const count = (s: string) => parts.filter((g) => g.reviewStatus === s).reduce((n, g) => n + g._count._all, 0);
    return { ...a, recorded: parts.reduce((n, g) => n.plus(g._sum.amount ?? 0), new Prisma.Decimal(0)).toString(), reviewed: count("REVIEWED"), pending: count("PENDING_REVIEW"), returned: count("RETURNED"), bookHref: book ? href("/accounting/bankbook", a.id) : undefined };
  });
  const rows = allRows.filter((a) => selectedAccount === null || a.id === selectedAccount);
  // Keep the complete account directory for switching the combobox.
  return {
    accounts: allRows,
    selectedAccount,
    recorded: rows.reduce((n, a) => n.plus(a.recorded), new Prisma.Decimal(0)).toString(),
    reviewed: rows.reduce((n, a) => n + a.reviewed, 0), pending: rows.reduce((n, a) => n + a.pending, 0), returned: rows.reduce((n, a) => n + a.returned, 0),
    tasks: tasks.map((r) => ({ id: r.id, code: r.code, at: r.at.toISOString(), amount: r.amount.toString(), partnerName: r.partner?.name ?? null, accountName: r.cashAccount.name, status: r.reviewStatus as "PENDING_REVIEW" | "RETURNED", href: receipts ? `/accounting/receipts/${r.id}` : book ? href("/accounting/bankbook", r.cashAccount.id) : undefined })),
    tasksHref: review ? href("/accounting/cash-review", selectedAccount ?? undefined, { kind: "RECEIPT", status: "PENDING_REVIEW,RETURNED", cashType: "BANK" }) : receipts ? href("/accounting/receipts", selectedAccount ?? undefined, { status: "PENDING_REVIEW,RETURNED", cashType: "BANK" }) : undefined,
    bookHref: book ? href("/accounting/bankbook", selectedAccount ?? undefined) : undefined,
  };
}
