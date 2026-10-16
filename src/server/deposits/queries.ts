import { Prisma, type PrismaClient } from "@prisma/client";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { listTimeRange, type ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { timeRangeWhere } from "@/lib/time-presets";
import { depositTimeOptions, type DepositState } from "@/lib/deposit-list";

type Db = Prisma.TransactionClient | PrismaClient;
export const DEPOSIT_FILTER_KEYS = ["state", "customer"] as const;
export interface DepositRowDTO {
  id: number; code: string; at: Date; partnerName: string; orderId: number | null; orderCode: string | null;
  amount: string; cashAccountName: string; isCancelled: boolean; note: string | null; reviewed: boolean;
}
export type DepositStats = Record<DepositState, { count: number; amount: string }>;
const STATE_WHERE: Record<Exclude<DepositState, "all">, Prisma.ReceiptWhereInput> = {
  attached: { isCancelled: false, orderId: { not: null } }, released: { isCancelled: false, orderId: null }, cancelled: { isCancelled: true },
};

/** Counts and sums cover the entire filtered set; cancelled receipts never enter the effective total. */
export async function listDeposits(db: Db, actor: Actor, params: ListParams, now = new Date()) {
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const states = (params.filters.state ?? []).filter((state): state is keyof typeof STATE_WHERE => Object.prototype.hasOwnProperty.call(STATE_WHERE, state));
  const stateWhere: Prisma.ReceiptWhereInput = states.length ? { OR: states.map((state) => STATE_WHERE[state]) } : {};
  const baseWhere: Prisma.ReceiptWhereInput = { AND: [
    { type: "COC" }, { partner: partnerScopeWhere(actor) },
    ...(params.filters.customer?.length ? [{ partnerId: { in: params.filters.customer.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) } }] : []),
    ...terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { order: { code: { contains: escapeLike(t.toUpperCase()) } } }, { partner: { searchText: { contains: escapeLike(t) } } }] })),
  ] };
  const range = listTimeRange(params, now);
  const datedWhere: Prisma.ReceiptWhereInput = { AND: [baseWhere, ...(range ? [{ at: timeRangeWhere(range) }] : [])] };
  const where: Prisma.ReceiptWhereInput = { AND: [datedWhere, stateWhere] };
  const [rows, total, customers, grouped, presetCounts] = await Promise.all([
    db.receipt.findMany({
      where, orderBy: [{ at: "desc" }, { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize,
      include: { partner: { select: { name: true } }, order: { select: { id: true, code: true } }, cashAccount: { select: { name: true } } },
    }),
    db.receipt.count({ where }),
    db.partner.findMany({ where: { AND: [partnerScopeWhere(actor), { receipts: { some: { type: "COC" } } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    Promise.all((Object.keys(STATE_WHERE) as (keyof typeof STATE_WHERE)[]).map(async (key) => {
      const value = await db.receipt.aggregate({ where: { AND: [datedWhere, STATE_WHERE[key]] }, _count: { _all: true }, _sum: { amount: true } });
      return [key, { count: value._count._all, amount: value._sum.amount?.toString() ?? "0" }] as const;
    })),
    Promise.all(depositTimeOptions(now).map(async (preset) => {
      const r = listTimeRange({ ...params, ...preset.patch }, now);
      return [preset.key, await db.receipt.count({ where: { AND: [baseWhere, stateWhere, ...(r ? [{ at: timeRangeWhere(r) }] : [])] } })] as const;
    })),
  ]);
  const groups = Object.fromEntries(grouped) as Omit<DepositStats, "all">;
  const activeAmount = new Prisma.Decimal(groups.attached.amount).plus(groups.released.amount);
  const stats: DepositStats = { ...groups, all: { count: grouped.reduce((sum, [, value]) => sum + value.count, 0), amount: activeAmount.toString() } };
  const effectiveAmount = ["attached", "released"].filter((state) => !states.length || states.includes(state as keyof typeof STATE_WHERE)).reduce((sum, key) => sum.plus(stats[key as DepositState].amount), new Prisma.Decimal(0)).toString();
  const out: DepositRowDTO[] = rows.map((r) => ({
    id: r.id, code: r.code, at: r.at, partnerName: r.partner?.name ?? "", orderId: r.order?.id ?? null, orderCode: r.order?.code ?? null,
    amount: r.amount.toString(), cashAccountName: r.cashAccount.name, isCancelled: r.isCancelled, note: r.note, reviewed: r.reviewStatus === "REVIEWED",
  }));
  return { rows: out, total, customers, stats, effectiveAmount, timeCounts: Object.fromEntries(presetCounts) };
}
