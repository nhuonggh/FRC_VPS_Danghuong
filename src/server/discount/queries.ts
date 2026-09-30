import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { DomainError } from "@/server/http/errors";
import { getOpenPeriod } from "@/server/period/guard";
import { discountBalance, partnerBalance } from "@/server/debt/balance";
import { SETTLE_METHOD_LABEL } from "./schemas";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const DISCOUNT_FILTER_KEYS = ["state"] as const;

export interface DiscountRowDTO { partnerId: number; code: string; name: string; groupName: string; opening: string; accrued: string; settled: string; balance: string; unreconciled: number }
export interface DiscountSummaryDTO { balance: string; negative: number; partners: number }

const need = (actor: Actor) => { if (!actor.perms.has("debt.view") && !actor.perms.has("discount.settle") && !actor.perms.has("discount.reconcile")) assertCan(actor.perms, "debt.view"); };

/**
 * Sổ chiết khấu tích lũy theo khách (D-37): số dư = đầu kỳ + Σ phát sinh (đơn) − Σ ra (tất toán / trừ nợ / trả hàng). TÍNH KHI ĐỌC.
 * Bỏ khách số dư 0 và không có phiếu chờ hậu kiểm. state: positive (còn nợ khách) | negative (số dư ÂM — cần điều chỉnh công nợ).
 */
export async function listDiscountBalances(db: Db, actor: Actor, params: ListParams, opts: { all?: boolean } = {}): Promise<{ rows: DiscountRowDTO[]; total: number; summary: DiscountSummaryDTO }> {
  need(actor);
  const period = await getOpenPeriod(db);
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const partners = await db.partner.findMany({
    where: { mergedIntoId: null, isCustomer: true, ...partnerScopeWhere(actor), AND: terms.map((t) => ({ OR: [{ searchText: { contains: escapeLike(t) } }, { code: { contains: escapeLike(t.toUpperCase()) } }] })) },
    select: { id: true, code: true, name: true, group: { select: { name: true } } },
  });
  const ids = partners.map((p) => p.id);
  const [openings, sums, unrec] = await Promise.all([
    db.openingDiscount.findMany({ where: { periodId: period.id, partnerId: { in: ids } }, select: { partnerId: true, amount: true } }),
    db.discountLedger.groupBy({ by: ["partnerId"], where: { periodId: period.id, partnerId: { in: ids } }, _sum: { amountIn: true, amountOut: true } }),
    db.discountLedger.groupBy({ by: ["partnerId"], where: { periodId: period.id, partnerId: { in: ids }, docType: "DISCOUNT_SETTLE", isReconciled: false }, _count: { _all: true } }),
  ]);
  const open = new Map(openings.map((o) => [o.partnerId, o.amount])); const sum = new Map(sums.map((s) => [s.partnerId, s._sum])); const un = new Map(unrec.map((u) => [u.partnerId, u._count._all]));
  const state = params.filters.state?.[0];
  let rows: DiscountRowDTO[] = partners.map((p) => {
    const o = open.get(p.id) ?? D(0); const s = sum.get(p.id); const inn = s?.amountIn ?? D(0); const out = s?.amountOut ?? D(0);
    return { partnerId: p.id, code: p.code, name: p.name, groupName: p.group.name, opening: o.toString(), accrued: inn.toString(), settled: out.toString(), balance: o.plus(inn).minus(out).toString(), unreconciled: un.get(p.id) ?? 0 };
  }).filter((r) => !D(r.balance).isZero() || r.unreconciled > 0);
  const negative = rows.filter((r) => D(r.balance).lt(0)).length;
  const total = rows.reduce((s, r) => s.plus(r.balance), D(0));
  if (state === "negative") rows = rows.filter((r) => D(r.balance).lt(0));
  else if (state === "positive") rows = rows.filter((r) => D(r.balance).gt(0));
  rows.sort((a, b) => Number(b.balance) - Number(a.balance) || a.code.localeCompare(b.code));
  const count = rows.length;
  return { total: count, rows: opts.all ? rows : rows.slice((params.page - 1) * params.pageSize, params.page * params.pageSize), summary: { balance: total.toString(), negative, partners: partners.length } };
}

export interface DiscountEntryDTO { id: number; at: Date; docType: string; docLabel: string; docCode: string | null; docHref: string | null; orderCode: string | null; amountIn: string; amountOut: string; running: string; method: string | null; isReconciled: boolean }
export interface SettlementDTO { id: number; code: string; at: Date; method: "CASH" | "OFFSET"; methodLabel: string; amount: string; note: string | null; paymentId: number | null; paymentCode: string | null; isCancelled: boolean; cancelReason: string | null; isReconciled: boolean; reconciledByName: string | null; createdByName: string | null }
export interface DiscountDetailDTO {
  partner: { id: number; code: string; name: string; debtBalance: string };
  opening: string; accrued: string; settled: string; balance: string; negative: boolean; total: number;
  entries: DiscountEntryDTO[]; settlements: SettlementDTO[];
}
const DOC_LABEL: Record<string, string> = {
  SALE: "Đơn hàng", SALE_EDIT: "Sửa đơn hàng", SALE_CANCEL: "Hủy đơn hàng", SALE_RESTORE: "Khôi phục đơn hàng", DISCOUNT_SETTLE: "Tất toán chiết khấu", RETURN: "Trả hàng", RETURN_CANCEL: "Hủy phiếu trả", DEBT_ADJ: "Điều chỉnh công nợ (trừ chiết khấu)", DEBT_ADJ_CANCEL: "Hủy điều chỉnh công nợ",
  DEBT_TRANSFER: "Gộp/chuyển công nợ", DEBT_TRANSFER_CANCEL: "Hủy gộp/chuyển",
};

export async function getDiscountDetail(db: Db, actor: Actor, partnerId: number, params: ListParams): Promise<DiscountDetailDTO> {
  need(actor);
  const period = await getOpenPeriod(db);
  const p = await db.partner.findFirst({ where: { id: partnerId, mergedIntoId: null, ...partnerScopeWhere(actor) }, select: { id: true, code: true, name: true } });
  if (!p) throw new DomainError("Không tìm thấy khách hàng.", 404);
  const [rows, opening, settlements, debt] = await Promise.all([
    db.discountLedger.findMany({ where: { periodId: period.id, partnerId }, orderBy: [{ at: "asc" }, { id: "asc" }], include: { orderLine: { select: { order: { select: { id: true, code: true } } } } } }),
    db.openingDiscount.findUnique({ where: { periodId_partnerId: { periodId: period.id, partnerId } }, select: { amount: true } }),
    db.discountSettlement.findMany({ where: { periodId: period.id, partnerId }, orderBy: [{ at: "desc" }, { id: "desc" }], include: { payment: { select: { code: true } } } }),
    partnerBalance(db, partnerId),
  ]);
  const settleRows = new Map(rows.filter((r) => r.docType === "DISCOUNT_SETTLE").map((r) => [r.docId, r]));
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set([...settlements.map((s) => s.createdBy), ...[...settleRows.values()].flatMap((r) => (r.reconciledBy ? [r.reconciledBy] : []))])] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const o = opening?.amount ?? D(0);
  let run = o;
  const withRun = rows.map((r) => { run = run.plus(r.amountIn).minus(r.amountOut); return { r, running: run }; });
  const accrued = rows.reduce((s, r) => s.plus(r.amountIn), D(0)); const settled = rows.reduce((s, r) => s.plus(r.amountOut), D(0));
  const page = withRun.reverse().slice((params.page - 1) * params.pageSize, params.page * params.pageSize);
  const codes = new Map(settlements.map((s) => [s.id, s.code]));
  return {
    partner: { id: p.id, code: p.code, name: p.name, debtBalance: debt.balance.toString() },
    opening: o.toString(), accrued: accrued.toString(), settled: settled.toString(), balance: run.toString(), negative: run.lt(0), total: rows.length,
    entries: page.map(({ r, running }) => ({
      id: r.id, at: r.at, docType: r.docType, docLabel: DOC_LABEL[r.docType] ?? r.docType,
      docCode: r.docType === "DISCOUNT_SETTLE" ? (codes.get(r.docId) ?? null) : (r.orderLine?.order.code ?? null), docHref: r.docType === "DISCOUNT_SETTLE" ? null : r.orderLine ? `/sales/orders/${r.orderLine.order.id}` : null, orderCode: r.orderLine?.order.code ?? null,
      amountIn: r.amountIn.toString(), amountOut: r.amountOut.toString(), running: running.toString(), method: r.settleMethod, isReconciled: r.isReconciled,
    })),
    settlements: settlements.map((s) => { const r = settleRows.get(s.id); return { id: s.id, code: s.code, at: s.at, method: s.method, methodLabel: SETTLE_METHOD_LABEL[s.method], amount: s.amount.toString(), note: s.note, paymentId: s.paymentId, paymentCode: s.payment?.code ?? null, isCancelled: s.isCancelled, cancelReason: s.cancelReason, isReconciled: r?.isReconciled ?? false, reconciledByName: r?.reconciledBy ? (names.get(r.reconciledBy) ?? null) : null, createdByName: names.get(s.createdBy) ?? null }; }),
  };
}

export { discountBalance };
