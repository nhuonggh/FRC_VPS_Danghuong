import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan, can } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { normalizeSearch } from "@/lib/search";
import { DomainError } from "@/server/http/errors";
import { previewClosing, type ClosePreview } from "./close";
import { grossOf } from "@/server/sales/queries";

type Db = PrismaClient;
const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
const norm = normalizeSearch;

/** Doanh thu dòng đơn — cùng công thức `lineAmountOf` (qty × giá làm tròn 2, lên nghìn đồng − chiết khấu đợt này). */
const LINE_AMOUNT = Prisma.sql`CEIL(ROUND(l.qty * l."salePrice", 2) / 1000) * 1000 - l."discountNow"`;

export interface PeriodRow {
  id: number; name: string; status: "OPEN" | "CLOSED"; openedAt: Date; closedAt: Date | null; closedByName: string | null;
  counts: { orders: number; purchases: number; receipts: number; payments: number };
}

/** Tra cứu kỳ (Plan 07 F2): chỉ ĐỌC, mọi hàm yêu cầu `period.view_closed`; số nhạy cảm theo quyền gốc (giá vốn/giá bán/phạm vi khách). */
export async function listPeriods(db: Db, actor: Actor): Promise<PeriodRow[]> {
  assertCan(actor.perms, "period.view_closed");
  const periods = await db.period.findMany({ orderBy: { id: "desc" } });
  const [orders, purchases, receipts, payments, users] = await Promise.all([
    db.saleOrder.groupBy({ by: ["periodId"], where: { isCancelled: false, isDraft: false }, _count: { _all: true } }),
    db.purchase.groupBy({ by: ["periodId"], where: { isCancelled: false }, _count: { _all: true } }),
    db.receipt.groupBy({ by: ["periodId"], where: { isCancelled: false }, _count: { _all: true } }),
    db.payment.groupBy({ by: ["periodId"], where: { isCancelled: false }, _count: { _all: true } }),
    db.user.findMany({ where: { id: { in: periods.flatMap((p) => (p.closedBy ? [p.closedBy] : [])) } }, select: { id: true, fullName: true } }),
  ]);
  const by = (rows: { periodId: number; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.periodId, r._count._all]));
  const [o, pu, r, pa] = [by(orders), by(purchases), by(receipts), by(payments)];
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  return periods.map((p) => ({
    id: p.id, name: p.name, status: p.status, openedAt: p.openedAt, closedAt: p.closedAt, closedByName: p.closedBy ? name.get(p.closedBy) ?? null : null,
    counts: { orders: o.get(p.id) ?? 0, purchases: pu.get(p.id) ?? 0, receipts: r.get(p.id) ?? 0, payments: pa.get(p.id) ?? 0 },
  }));
}

export async function getPeriodOrThrow(db: Db, actor: Actor, id: number) {
  assertCan(actor.perms, "period.view_closed");
  const p = await db.period.findUnique({ where: { id } });
  if (!p) throw new DomainError("Không tìm thấy kỳ.", 404);
  return p;
}

export interface PeriodOverview {
  period: { id: number; name: string; status: "OPEN" | "CLOSED"; openedAt: Date; closedAt: Date | null };
  /** Số đầu kỳ (từ `opening_*` của kỳ). Giá trị tồn chỉ có khi `cost.view`; công nợ chỉ khi `partner.view_all`. */
  opening: { stockLots: number; stockQty: string; stockValue?: string; receivable?: string; payable?: string; cash: string; discount?: string };
  /** Số cuối kỳ (tính từ sổ — kỳ đang mở thì là số hiện tại). */
  closing: { stock: Omit<ClosePreview["stock"], "value"> & { value?: string }; receivable?: string; payable?: string; cash: string; discount?: string };
  activity: { orders: number; revenue?: string; purchases: number; purchaseTotal?: string; receipts: number; receiptTotal: string; payments: number; paymentTotal: string; returns: number };
}

export async function periodOverview(db: Db, actor: Actor, id: number): Promise<PeriodOverview> {
  const p = await getPeriodOrThrow(db, actor, id);
  const cost = can(actor.perms, "cost.view"), partners = can(actor.perms, "partner.view_all"), sale = can(actor.perms, "sale_price.view"), buyp = can(actor.perms, "purchase_price.view");
  const [openStock, openDebt, openCash, openDisc, closing, rev, pur, rc, pm, rt, cnt] = await Promise.all([
    db.openingStock.aggregate({ where: { periodId: id }, _count: { _all: true }, _sum: { qty: true } }),
    db.openingDebt.findMany({ where: { periodId: id }, select: { amount: true } }),
    db.openingCash.aggregate({ where: { periodId: id }, _sum: { amount: true } }),
    db.openingDiscount.aggregate({ where: { periodId: id }, _sum: { amount: true } }),
    previewClosing(db, id),
    db.$queryRaw<{ revenue: Prisma.Decimal }[]>`
      SELECT COALESCE(SUM(${LINE_AMOUNT}), 0) AS revenue FROM sale_orders o JOIN sale_order_lines l ON l."orderId" = o.id
       WHERE o."periodId" = ${id} AND o."isCancelled" = false AND o."isDraft" = false`,
    db.purchase.aggregate({ where: { periodId: id, isCancelled: false }, _count: { _all: true }, _sum: { purchaseTotal: true } }),
    db.receipt.aggregate({ where: { periodId: id, isCancelled: false }, _count: { _all: true }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { periodId: id, isCancelled: false }, _count: { _all: true }, _sum: { amount: true } }),
    db.goodsReturn.count({ where: { periodId: id, isCancelled: false } }),
    db.saleOrder.count({ where: { periodId: id, isCancelled: false, isDraft: false } }),
  ]);
  const openValue = (await db.$queryRaw<{ v: Prisma.Decimal }[]>`SELECT COALESCE(SUM(qty * "unitCost"), 0) AS v FROM opening_stock WHERE "periodId" = ${id}`)[0]!.v;
  const debts = openDebt.map((d) => D(d.amount));
  const sum = (v: Prisma.Decimal[]) => v.reduce((a, b) => a.plus(b), D(0));
  return {
    period: { id: p.id, name: p.name, status: p.status, openedAt: p.openedAt, closedAt: p.closedAt },
    opening: {
      stockLots: openStock._count._all, stockQty: D(openStock._sum.qty).toString(),
      ...(cost ? { stockValue: D(openValue).toFixed(2) } : {}),
      ...(partners ? { receivable: sum(debts.filter((v) => v.gt(0))).toFixed(2), payable: sum(debts.filter((v) => v.lt(0))).abs().toFixed(2), discount: D(openDisc._sum.amount).toFixed(2) } : {}),
      cash: D(openCash._sum.amount).toFixed(2),
    },
    closing: {
      stock: { lots: closing.stock.lots, products: closing.stock.products, qty: closing.stock.qty, ...(cost ? { value: closing.stock.value } : {}) },
      ...(partners ? { receivable: closing.receivable.total, payable: closing.payable.total, discount: closing.discount.total } : {}),
      cash: sum(closing.cash.map((c) => D(c.balance))).toFixed(2),
    },
    activity: {
      orders: cnt, ...(sale ? { revenue: D(rev[0]!.revenue).toFixed(2) } : {}), purchases: pur._count._all, ...(buyp ? { purchaseTotal: D(pur._sum.purchaseTotal).toFixed(2) } : {}),
      receipts: rc._count._all, receiptTotal: D(rc._sum.amount).toFixed(2), payments: pm._count._all, paymentTotal: D(pm._sum.amount).toFixed(2), returns: rt,
    },
  };
}

export interface StockRow { productId: number; code: string; name: string; unit: string; opening: string; inQty: string; outQty: string; closing: string; closingValue?: string }

/** XNT của một kỳ: đầu kỳ = lô OPENING; nhập/xuất = phát sinh khác OPENING; cuối kỳ = còn lại trên lớp (trừ phần xuất treo). */
export async function periodStock(db: Db, actor: Actor, id: number, q?: string): Promise<StockRow[]> {
  assertCan(actor.perms, "stock.view");
  await getPeriodOrThrow(db, actor, id);
  const cost = can(actor.perms, "cost.view");
  const [flow, layers, products] = await Promise.all([
    db.$queryRaw<{ productId: number; opening: Prisma.Decimal; qin: Prisma.Decimal; qout: Prisma.Decimal; prov: Prisma.Decimal }[]>`
      SELECT "productId",
             COALESCE(SUM(CASE WHEN "docType" = 'OPENING' THEN "qtyIn" END), 0) AS opening,
             COALESCE(SUM(CASE WHEN "docType" <> 'OPENING' THEN "qtyIn" END), 0) AS qin,
             COALESCE(SUM("qtyOut"), 0) AS qout, COALESCE(SUM("qtyProvisional"), 0) AS prov
        FROM stock_ledger WHERE "periodId" = ${id} GROUP BY "productId"`,
    db.$queryRaw<{ productId: number; rem: Prisma.Decimal; val: Prisma.Decimal }[]>`
      SELECT "productId", COALESCE(SUM("qtyRemaining"), 0) AS rem, COALESCE(SUM("qtyRemaining" * "unitCost"), 0) AS val FROM cost_layers WHERE "periodId" = ${id} GROUP BY "productId"`,
    db.product.findMany({ select: { id: true, code: true, name: true, baseUnit: true, searchText: true } }),
  ]);
  const flowBy = new Map(flow.map((r) => [r.productId, r])), layerBy = new Map(layers.map((r) => [r.productId, r]));
  const needle = q ? norm(q.trim()) : "";
  return products
    .filter((p) => (flowBy.has(p.id) || layerBy.has(p.id)) && (!needle || norm(`${p.code} ${p.name}`).includes(needle) || p.searchText.includes(needle)))
    .map((p) => {
      const f = flowBy.get(p.id), l = layerBy.get(p.id);
      return { productId: p.id, code: p.code, name: p.name, unit: p.baseUnit, opening: D(f?.opening).toString(), inQty: D(f?.qin).toString(), outQty: D(f?.qout).toString(), closing: D(l?.rem).minus(D(f?.prov)).toString(), ...(cost ? { closingValue: D(l?.val).toFixed(2) } : {}) };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

export interface DebtRow { partnerId: number; code: string; name: string; opening: string; debit: string; credit: string; closing: string }

export async function periodDebts(db: Db, actor: Actor, id: number, q?: string): Promise<DebtRow[]> {
  assertCan(actor.perms, "debt.view");
  await getPeriodOrThrow(db, actor, id);
  const [partners, opening, sums] = await Promise.all([
    db.partner.findMany({ where: partnerScopeWhere(actor), select: { id: true, code: true, name: true, searchText: true } }),
    db.openingDebt.findMany({ where: { periodId: id }, select: { partnerId: true, amount: true } }),
    db.partnerLedger.groupBy({ by: ["partnerId"], where: { periodId: id }, _sum: { debit: true, credit: true } }),
  ]);
  const o = new Map(opening.map((r) => [r.partnerId, D(r.amount)])), s = new Map(sums.map((r) => [r.partnerId, r._sum]));
  const needle = q ? norm(q.trim()) : "";
  return partners
    .filter((p) => (o.has(p.id) || s.has(p.id)) && (!needle || norm(`${p.code} ${p.name}`).includes(needle) || p.searchText.includes(needle)))
    .map((p) => {
      const open = o.get(p.id) ?? D(0), debit = D(s.get(p.id)?.debit), credit = D(s.get(p.id)?.credit);
      return { partnerId: p.id, code: p.code, name: p.name, opening: open.toFixed(2), debit: debit.toFixed(2), credit: credit.toFixed(2), closing: open.plus(debit).minus(credit).toFixed(2) };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

export interface CashRow { accountId: number; name: string; type: string; opening: string; amountIn: string; amountOut: string; closing: string }

export async function periodCash(db: Db, actor: Actor, id: number): Promise<CashRow[]> {
  assertCan(actor.perms, "cashbook.view");
  await getPeriodOrThrow(db, actor, id);
  const [accounts, opening, sums] = await Promise.all([
    db.cashAccount.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    db.openingCash.findMany({ where: { periodId: id }, select: { cashAccountId: true, amount: true } }),
    db.cashLedger.groupBy({ by: ["cashAccountId"], where: { periodId: id }, _sum: { amountIn: true, amountOut: true } }),
  ]);
  const o = new Map(opening.map((r) => [r.cashAccountId, D(r.amount)])), s = new Map(sums.map((r) => [r.cashAccountId, r._sum]));
  return accounts.filter((a) => o.has(a.id) || s.has(a.id)).map((a) => {
    const open = o.get(a.id) ?? D(0), inn = D(s.get(a.id)?.amountIn), out = D(s.get(a.id)?.amountOut);
    return { accountId: a.id, name: a.name, type: a.type, opening: open.toFixed(2), amountIn: inn.toFixed(2), amountOut: out.toFixed(2), closing: open.plus(inn).minus(out).toFixed(2) };
  });
}

export interface PeriodOrderRow { id: number; code: string; orderDate: Date; partnerName: string; status: string; total?: string }

export async function periodOrders(db: Db, actor: Actor, id: number, opts: { q?: string; page: number; pageSize: number }): Promise<{ rows: PeriodOrderRow[]; total: number }> {
  assertCan(actor.perms, "order.view");
  await getPeriodOrThrow(db, actor, id);
  const sale = can(actor.perms, "sale_price.view");
  const q = opts.q?.trim();
  const where: Prisma.SaleOrderWhereInput = { periodId: id, partner: partnerScopeWhere(actor), ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { partner: { searchText: { contains: norm(q) } } }] } : {}) };
  const [total, rows] = await Promise.all([
    db.saleOrder.count({ where }),
    db.saleOrder.findMany({
      where, orderBy: [{ orderDate: "desc" }, { id: "desc" }], skip: (opts.page - 1) * opts.pageSize, take: opts.pageSize,
      select: { id: true, code: true, orderDate: true, isCancelled: true, isDraft: true, deliveryStatus: true, partner: { select: { name: true } }, lines: { select: { qty: true, salePrice: true, discountNow: true } } },
    }),
  ]);
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id, code: r.code, orderDate: r.orderDate, partnerName: r.partner.name, status: r.isCancelled ? "Đã hủy" : r.isDraft ? "Nháp" : r.deliveryStatus,
      ...(sale ? { total: r.lines.reduce((s, l) => s.plus(grossOf(D(l.qty), l.salePrice)).minus(l.discountNow), D(0)).toFixed(2) } : {}),
    })),
  };
}
