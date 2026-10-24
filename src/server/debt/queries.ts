import { Prisma, type PrismaClient } from "@prisma/client";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { listTimeRange, type ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { DomainError } from "@/server/http/errors";
import { getOpenPeriod } from "@/server/period/guard";
import { toBalance } from "./balance";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export const DEBT_FILTER_KEYS = ["kind", "state"] as const;

export interface DebtRowDTO {
  partnerId: number; code: string; name: string; isCustomer: boolean; isSupplier: boolean; groupName: string;
  opening: string; debit: string; credit: string; balance: string; discountBalance: string; debtLimit: string; overLimit: boolean;
}
export interface DebtSummaryDTO { receivable: string; payable: string; discount: string; partners: number }

const SORTS = ["balance", "code", "name", "discountBalance"] as const;

/**
 * Công nợ tổng hợp (62): số dư mọi đối tác tính khi đọc từ sổ (1 truy vấn gộp theo đối tác, không N+1).
 * Lọc: kind (customer/supplier), state (owing = phải thu, credit = phải trả; mặc định cả hai — bỏ đối tác số dư 0), q.
 * Xếp hạng theo số dư (mặc định giảm dần = nợ nhiều nhất trước). Tổng phải thu/phải trả tính trên TOÀN bộ tập đã lọc.
 */
export async function listDebts(db: Db, actor: Actor, params: ListParams, opts: { all?: boolean } = {}) {
  const period = await getOpenPeriod(db);
  const range = listTimeRange(params);
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const kinds = params.filters.kind ?? [];
  const partners = await db.partner.findMany({
    where: {
      mergedIntoId: null,
      ...partnerScopeWhere(actor),
      ...(kinds.length === 1 ? (kinds[0] === "supplier" ? { isSupplier: true } : { isCustomer: true }) : {}),
      AND: terms.map((t) => ({ OR: [{ searchText: { contains: escapeLike(t) } }, { code: { contains: escapeLike(t.toUpperCase()) } }] })),
    },
    select: { id: true, code: true, name: true, isCustomer: true, isSupplier: true, debtLimit: true, group: { select: { name: true } } },
  });
  const ids = partners.map((p) => p.id);
  // Có khoảng thời gian: đầu kỳ = đầu kỳ sổ + phát sinh trước ngày bắt đầu; debit/credit = phát sinh trong khoảng; số dư = cuối khoảng.
  const sumBy = (at?: Prisma.DateTimeFilter) => db.partnerLedger.groupBy({ by: ["partnerId"], where: { periodId: period.id, partnerId: { in: ids }, ...(at ? { at } : {}) }, _sum: { debit: true, credit: true } });
  const [ledger, before, opening, discIn, discOpen] = await Promise.all([
    sumBy(range ? { gte: range.start, lt: range.end } : undefined),
    range ? sumBy({ lt: range.start }) : Promise.resolve([] as Awaited<ReturnType<typeof sumBy>>),
    db.openingDebt.findMany({ where: { periodId: period.id, partnerId: { in: ids } }, select: { partnerId: true, amount: true } }),
    db.discountLedger.groupBy({ by: ["partnerId"], where: { periodId: period.id, partnerId: { in: ids } }, _sum: { amountIn: true, amountOut: true } }),
    db.openingDiscount.findMany({ where: { periodId: period.id, partnerId: { in: ids } }, select: { partnerId: true, amount: true } }),
  ]);
  const led = new Map(ledger.map((l) => [l.partnerId, l._sum]));
  const bef = new Map(before.map((l) => [l.partnerId, l._sum]));
  const open = new Map(opening.map((o) => [o.partnerId, o.amount]));
  const dl = new Map(discIn.map((l) => [l.partnerId, l._sum]));
  const dOpen = new Map(discOpen.map((o) => [o.partnerId, o.amount]));

  const state = params.filters.state ?? [];
  const all = partners.map((p) => {
    const b = toBalance((open.get(p.id) ?? D(0)).plus(bef.get(p.id)?.debit ?? 0).minus(bef.get(p.id)?.credit ?? 0), led.get(p.id)?.debit ?? D(0), led.get(p.id)?.credit ?? D(0));
    const disc = (dOpen.get(p.id) ?? D(0)).plus(dl.get(p.id)?.amountIn ?? 0).minus(dl.get(p.id)?.amountOut ?? 0);
    return { p, b, disc };
  }).filter(({ b }) => {
    if (state.length === 1) return state[0] === "credit" ? b.balance.lt(0) : b.balance.gt(0);
    // Trong khoảng thời gian: đối tác có phát sinh vẫn hiện dù số dư cuối bằng 0 (để gửi đối chiếu).
    return !b.balance.eq(0) || (range !== null && (b.debit.gt(0) || b.credit.gt(0)));
  });

  const sortKey = (SORTS as readonly string[]).includes((params.sort ?? "").replace(/^-/, "")) ? (params.sort ?? "").replace(/^-/, "") : "balance";
  const dir = params.sort ? (params.sort.startsWith("-") ? -1 : 1) : -1; // mặc định: số dư giảm dần
  const val = (x: (typeof all)[number]): string | Prisma.Decimal => (sortKey === "code" ? x.p.code : sortKey === "name" ? x.p.name : sortKey === "discountBalance" ? x.disc : x.b.balance);
  all.sort((a, b) => {
    const va = val(a), vb = val(b);
    const c = typeof va === "string" ? va.localeCompare(vb as string, "vi") : va.comparedTo(vb as Prisma.Decimal);
    return (c || a.p.code.localeCompare(b.p.code)) * dir;
  });

  const summary: DebtSummaryDTO = {
    receivable: all.reduce((s, x) => (x.b.balance.gt(0) ? s.plus(x.b.balance) : s), D(0)).toString(),
    payable: all.reduce((s, x) => (x.b.balance.lt(0) ? s.plus(x.b.balance.abs()) : s), D(0)).toString(),
    discount: all.reduce((s, x) => s.plus(x.disc.gt(0) ? x.disc : 0), D(0)).toString(),
    partners: all.length,
  };
  const slice = opts.all ? all : all.slice((params.page - 1) * params.pageSize, params.page * params.pageSize);
  const rows: DebtRowDTO[] = slice.map(({ p, b, disc }) => ({
    partnerId: p.id, code: p.code, name: p.name, isCustomer: p.isCustomer, isSupplier: p.isSupplier, groupName: p.group.name,
    opening: b.opening.toString(), debit: b.debit.toString(), credit: b.credit.toString(), balance: b.balance.toString(), discountBalance: disc.toString(),
    debtLimit: p.debtLimit.toString(), overLimit: p.debtLimit.gt(0) && b.balance.gt(p.debtLimit),
  }));
  return { rows, total: all.length, summary };
}

// ───────────────────────────── CHI TIẾT MỘT ĐỐI TÁC (63) ─────────────────────────────
export const DOC_LABEL: Record<string, string> = {
  DELIVERY: "Phiếu giao", RECEIPT: "Phiếu thu/cọc", RETURN: "Phiếu trả hàng", PURCHASE: "Phiếu nhập", DEBT_ADJ: "Điều chỉnh công nợ", DEBT_TRANSFER: "Gộp/chuyển công nợ", PAYMENT: "Phiếu chi", DISCOUNT_SETTLE: "Tất toán chiết khấu", TRIP_COLLECT: "Tiền lái xe thu (chuyến)", TRIP_DISCOUNT: "Tiền bớt khi giao (chuyến)", CASH_ADJ: "Điều chỉnh phiếu thu/chi",
};
export interface DebtEntryDTO { id: number; at: Date; docType: string; docLabel: string; docCode: string | null; docHref: string | null; debit: string; credit: string; running: string }
export interface DebtDetailDTO {
  partner: { id: number; code: string; name: string; isCustomer: boolean; isSupplier: boolean; groupName: string; debtLimit: string };
  opening: string; debit: string; credit: string; balance: string; discountBalance: string;
  /** Đối chiếu: số dư cộng dồn của dòng cuối phải bằng số dư tính gộp. */
  reconciled: boolean;
  /** Khoảng thời gian đang xem (null = cả kỳ). Có khoảng: opening/debit/credit/balance là của khoảng đó. */
  range: { start: Date; end: Date } | null;
  entries: DebtEntryDTO[]; total: number;
}

/** Chi tiết công nợ từng chứng từ: số dư chạy TÍNH KHI ĐỌC (đầu kỳ + cộng dồn), hiển thị mới nhất trước, có phân trang. */
export async function getDebtDetail(db: Db, actor: Actor, partnerId: number, params: ListParams): Promise<DebtDetailDTO> {
  const period = await getOpenPeriod(db);
  const range = listTimeRange(params);
  const p = await db.partner.findFirst({ where: { id: partnerId, ...partnerScopeWhere(actor) }, include: { group: { select: { name: true } } } });
  if (!p) throw new DomainError("Không tìm thấy đối tác.", 404);
  const [rows, opening, discIn, discOpen] = await Promise.all([
    db.partnerLedger.findMany({ where: { periodId: period.id, partnerId }, orderBy: [{ at: "asc" }, { id: "asc" }] }),
    db.openingDebt.findUnique({ where: { periodId_partnerId: { periodId: period.id, partnerId } }, select: { amount: true } }),
    db.discountLedger.aggregate({ where: { periodId: period.id, partnerId }, _sum: { amountIn: true, amountOut: true } }),
    db.openingDiscount.findUnique({ where: { periodId_partnerId: { periodId: period.id, partnerId } }, select: { amount: true } }),
  ]);
  const b = toBalance(opening?.amount ?? D(0), rows.reduce((s, r) => s.plus(r.debit), D(0)), rows.reduce((s, r) => s.plus(r.credit), D(0)));
  let run = b.opening;
  const withRun = rows.map((r) => { run = run.plus(r.debit).minus(r.credit); return { r, running: run }; });
  const inRange = range ? withRun.filter(({ r }) => r.at >= range.start && r.at < range.end) : withRun;
  const beforeRange = range ? withRun.filter(({ r }) => r.at < range.start) : [];
  const view = toBalance(
    b.opening.plus(beforeRange.reduce((s, x) => s.plus(x.r.debit), D(0))).minus(beforeRange.reduce((s, x) => s.plus(x.r.credit), D(0))),
    inRange.reduce((s, x) => s.plus(x.r.debit), D(0)), inRange.reduce((s, x) => s.plus(x.r.credit), D(0)),
  );
  const page = [...inRange].reverse().slice((params.page - 1) * params.pageSize, params.page * params.pageSize);

  const idsOf = (t: string) => page.filter((x) => x.r.docType === t).map((x) => x.r.docId);
  const [notes, receipts, returns, purchases, adjs, transfers, payments, settles, stops] = await Promise.all([
    db.deliveryNote.findMany({ where: { id: { in: idsOf("DELIVERY") } }, select: { id: true, code: true, orderId: true } }),
    db.receipt.findMany({ where: { id: { in: idsOf("RECEIPT") } }, select: { id: true, code: true, orderId: true } }),
    db.goodsReturn.findMany({ where: { id: { in: idsOf("RETURN") } }, select: { id: true, code: true } }),
    db.purchase.findMany({ where: { id: { in: idsOf("PURCHASE") } }, select: { id: true, code: true } }),
    db.debtAdjustment.findMany({ where: { id: { in: idsOf("DEBT_ADJ") } }, select: { id: true, code: true } }),
    db.debtTransfer.findMany({ where: { id: { in: idsOf("DEBT_TRANSFER") } }, select: { id: true, code: true } }),
    db.payment.findMany({ where: { id: { in: idsOf("PAYMENT") } }, select: { id: true, code: true } }),
    db.discountSettlement.findMany({ where: { id: { in: idsOf("DISCOUNT_SETTLE") } }, select: { id: true, code: true, partnerId: true } }),
    db.tripOrder.findMany({ where: { id: { in: [...idsOf("TRIP_COLLECT"), ...idsOf("TRIP_DISCOUNT")] } }, select: { id: true, tripId: true, trip: { select: { code: true } } } }),
  ]);
  const code = new Map<string, { code: string; href: string | null }>();
  notes.forEach((n) => code.set(`DELIVERY:${n.id}`, { code: n.code, href: `/sales/orders/${n.orderId}?tab=delivery` }));
  receipts.forEach((n) => code.set(`RECEIPT:${n.id}`, { code: n.code, href: `/accounting/receipts/${n.id}` }));
  returns.forEach((n) => code.set(`RETURN:${n.id}`, { code: n.code, href: `/returns/${n.id}` }));
  purchases.forEach((n) => code.set(`PURCHASE:${n.id}`, { code: n.code, href: `/purchase/orders/${n.id}` }));
  adjs.forEach((n) => code.set(`DEBT_ADJ:${n.id}`, { code: n.code, href: "/accounting/debt-adjustments" }));
  transfers.forEach((n) => code.set(`DEBT_TRANSFER:${n.id}`, { code: n.code, href: "/accounting/debt-transfers" }));
  settles.forEach((n) => code.set(`DISCOUNT_SETTLE:${n.id}`, { code: n.code, href: `/accounting/discounts/${n.partnerId}` }));
  stops.forEach((n) => { const v = { code: n.trip.code, href: `/delivery/trips/${n.tripId}` }; code.set(`TRIP_COLLECT:${n.id}`, v); code.set(`TRIP_DISCOUNT:${n.id}`, v); });
  payments.forEach((n) => code.set(`PAYMENT:${n.id}`, { code: n.code, href: `/accounting/payments/${n.id}` }));

  return {
    partner: { id: p.id, code: p.code, name: p.name, isCustomer: p.isCustomer, isSupplier: p.isSupplier, groupName: p.group.name, debtLimit: p.debtLimit.toString() },
    opening: view.opening.toString(), debit: view.debit.toString(), credit: view.credit.toString(), balance: view.balance.toString(),
    discountBalance: (discOpen?.amount ?? D(0)).plus(discIn._sum.amountIn ?? 0).minus(discIn._sum.amountOut ?? 0).toString(),
    reconciled: run.eq(b.balance),
    range: range ? { start: range.start, end: range.end } : null,
    total: inRange.length,
    entries: page.map(({ r, running }) => {
      const c = code.get(`${r.docType}:${r.docId}`);
      return { id: r.id, at: r.at, docType: r.docType, docLabel: DOC_LABEL[r.docType] ?? r.docType, docCode: c?.code ?? null, docHref: c?.href ?? null, debit: r.debit.toString(), credit: r.credit.toString(), running: running.toString() };
    }),
  };
}

// ───────────────────────────── DANH SÁCH ĐIỀU CHỈNH / CHUYỂN (64, 65) ─────────────────────────────
export interface AdjustmentRowDTO { id: number; code: string; at: Date; partnerId: number; partnerCode: string; partnerName: string; reason: string; amount: string; note: string; isCancelled: boolean; cancelReason: string | null }
export interface TransferRowDTO { id: number; code: string; at: Date; kind: "TRANSFER" | "MERGE"; fromCode: string; fromName: string; toCode: string; toName: string; amount: string; discountMoved: string; note: string | null; isCancelled: boolean }

export async function listAdjustments(db: Db, actor: Actor, params: ListParams) {
  const range = listTimeRange(params);
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const where: Prisma.DebtAdjustmentWhereInput = {
    ...(range ? { at: { gte: range.start, lt: range.end } } : {}),
    partner: partnerScopeWhere(actor),
    AND: terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { partner: { searchText: { contains: escapeLike(t) } } }] })),
  };
  const [rows, total] = await Promise.all([
    db.debtAdjustment.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize, include: { partner: { select: { code: true, name: true } } } }),
    db.debtAdjustment.count({ where }),
  ]);
  const out: AdjustmentRowDTO[] = rows.map((r) => ({ id: r.id, code: r.code, at: r.at, partnerId: r.partnerId, partnerCode: r.partner.code, partnerName: r.partner.name, reason: r.reason, amount: r.amount.toString(), note: r.note, isCancelled: r.isCancelled, cancelReason: r.cancelReason }));
  return { rows: out, total };
}

export async function listTransfers(db: Db, actor: Actor, params: ListParams) {
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const scope = partnerScopeWhere(actor);
  const where: Prisma.DebtTransferWhereInput = {
    from: scope, to: scope,
    AND: terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { from: { searchText: { contains: escapeLike(t) } } }, { to: { searchText: { contains: escapeLike(t) } } }] })),
  };
  const [rows, total] = await Promise.all([
    db.debtTransfer.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize, include: { from: { select: { code: true, name: true } }, to: { select: { code: true, name: true } } } }),
    db.debtTransfer.count({ where }),
  ]);
  const out: TransferRowDTO[] = rows.map((r) => ({ id: r.id, code: r.code, at: r.at, kind: r.kind, fromCode: r.from.code, fromName: r.from.name, toCode: r.to.code, toName: r.to.name, amount: r.amount.toString(), discountMoved: r.discountMoved.toString(), note: r.note, isCancelled: r.isCancelled }));
  return { rows: out, total };
}

/** Gợi ý đối tác (khách + NCC, chưa gộp) cho form điều chỉnh/chuyển nợ — chỉ cần debt.*, không cần quyền danh mục đối tác. */
export async function searchDebtPartners(db: Db, actor: Actor, q: string) {
  const terms = normalizeSearch(q).split(" ").filter(Boolean);
  const rows = await db.partner.findMany({
    where: { mergedIntoId: null, ...partnerScopeWhere(actor), AND: terms.map((t) => ({ OR: [{ searchText: { contains: escapeLike(t) } }, { code: { contains: escapeLike(t.toUpperCase()) } }] })) },
    orderBy: { name: "asc" }, take: 20, select: { id: true, code: true, name: true, isCustomer: true, isSupplier: true },
  });
  return rows.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}`, hint: [r.isCustomer ? "Khách" : null, r.isSupplier ? "NCC" : null].filter(Boolean).join(" · ") }));
}
