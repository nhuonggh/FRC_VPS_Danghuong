import type { Prisma, PrismaClient } from "@prisma/client";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";

type Db = Prisma.TransactionClient | PrismaClient;

export const DEPOSIT_FILTER_KEYS = ["state"] as const;

export interface DepositRowDTO {
  id: number; code: string; at: Date; partnerName: string; orderId: number | null; orderCode: string | null;
  amount: string; cashAccountName: string; isCancelled: boolean; note: string | null;
}

/** Quản lý tiền cọc (mã 36). state: `attached` (đang gắn đơn), `released` (đã thành số dư khách), `cancelled`. */
export async function listDeposits(db: Db, actor: Actor, params: ListParams) {
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const state = params.filters.state?.[0];
  const where: Prisma.ReceiptWhereInput = {
    AND: [
      { type: "COC" },
      { partner: partnerScopeWhere(actor) },
      ...(state === "attached" ? [{ isCancelled: false, orderId: { not: null } }] : state === "released" ? [{ isCancelled: false, orderId: null }] : state === "cancelled" ? [{ isCancelled: true }] : []),
      ...terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { order: { code: { contains: escapeLike(t.toUpperCase()) } } }, { partner: { searchText: { contains: escapeLike(t) } } }] })),
    ],
  };
  const [rows, total] = await Promise.all([
    db.receipt.findMany({
      where, orderBy: [{ at: "desc" }, { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize,
      include: { partner: { select: { name: true } }, order: { select: { id: true, code: true } }, cashAccount: { select: { name: true } } },
    }),
    db.receipt.count({ where }),
  ]);
  const out: DepositRowDTO[] = rows.map((r) => ({
    id: r.id, code: r.code, at: r.at, partnerName: r.partner.name, orderId: r.order?.id ?? null, orderCode: r.order?.code ?? null,
    amount: r.amount.toString(), cashAccountName: r.cashAccount.name, isCancelled: r.isCancelled, note: r.note,
  }));
  return { rows: out, total };
}
