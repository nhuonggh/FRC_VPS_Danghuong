import { Prisma } from "@prisma/client";
import { formatCurrency } from "@/lib/format";
import { can } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { getOpenPeriod } from "@/server/period/guard";
import { byDay, byMonth, canAny, cell, daysOf, MONTH_LABELS, num, partnerBalances, pctDelta, sqlDay, sqlMonth, topSlices, yearBounds, yearOfRange, type Db, type DashRange } from "./common";
import type { Dashboard, Kpi, Widget } from "./types";
import { bankRangeQuery, loadBankReceipts } from "./bank-receipts";

/** Tổng `_sum.amount` của một aggregate; không có quyền → 0 (widget tương ứng không được dựng). */
const sumOf = async (enabled: boolean, p: Promise<{ _sum: { amount: Prisma.Decimal | null } }>) => (enabled ? num((await p)._sum.amount) : 0);

const RECEIPT_TYPE_SQL = Prisma.sql`CASE r.type::text WHEN 'THU_NO' THEN 'Thu nợ khách' WHEN 'COC' THEN 'Tiền cọc' ELSE 'Thu khác' END`;
const PAYMENT_KIND_SQL = Prisma.sql`CASE WHEN p.kind::text = 'CHI_PHI' THEN COALESCE(et.name, 'Chi phí')
  WHEN p.kind::text = 'TRA_NCC' THEN 'Trả nhà cung cấp' WHEN p.kind::text = 'HOAN_KHACH' THEN 'Hoàn tiền khách'
  WHEN p.kind::text = 'TAT_TOAN_CK' THEN 'Tất toán chiết khấu' ELSE 'Chi khác' END`;

export async function loadAccounting(db: Db, actor: Actor, range: DashRange, bankAccount?: string): Promise<Dashboard> {
  const cash = canAny(actor, ["cashbook.view", "receipt.manage", "payment.manage"]);
  const debt = can(actor.perms, "debt.view");
  const book = can(actor.perms, "cashbook.view");
  const period = await getOpenPeriod(db);
  const year = yearOfRange(range), yb = yearBounds(year);
  const days = daysOf(range);
  const rc = (from: Date, to: Date) => ({ isCancelled: false, at: { gte: from, lt: to } });

  const empty = Promise.resolve([] as never[]);
  const [thu, prevThu, chi, prevChi, monthlyIn, monthlyOut, dailyIn, dailyOut, thuMix, chiMix, rcReview, pmReview, rcCancel, pmCancel, openingCash, ledger, accounts, balances, bankReceipts] = await Promise.all([
    sumOf(cash, db.receipt.aggregate({ where: rc(range.start, range.end), _sum: { amount: true } })),
    sumOf(cash, db.receipt.aggregate({ where: rc(range.prevStart, range.prevEnd), _sum: { amount: true } })),
    sumOf(cash, db.payment.aggregate({ where: rc(range.start, range.end), _sum: { amount: true } })),
    sumOf(cash, db.payment.aggregate({ where: rc(range.prevStart, range.prevEnd), _sum: { amount: true } })),
    cash ? db.$queryRaw<{ m: number; v: Prisma.Decimal }[]>`SELECT ${sqlMonth(Prisma.sql`"at"`)} AS m, COALESCE(SUM(amount),0) AS v FROM receipts WHERE "isCancelled" = false AND "at" >= ${yb.start} AND "at" < ${yb.end} GROUP BY 1` : empty,
    cash ? db.$queryRaw<{ m: number; v: Prisma.Decimal }[]>`SELECT ${sqlMonth(Prisma.sql`"at"`)} AS m, COALESCE(SUM(amount),0) AS v FROM payments WHERE "isCancelled" = false AND "at" >= ${yb.start} AND "at" < ${yb.end} GROUP BY 1` : empty,
    cash && days ? db.$queryRaw<{ d: string; v: Prisma.Decimal }[]>`SELECT ${sqlDay(Prisma.sql`"at"`)} AS d, COALESCE(SUM(amount),0) AS v FROM receipts WHERE "isCancelled" = false AND "at" >= ${range.start} AND "at" < ${range.end} GROUP BY 1` : empty,
    cash && days ? db.$queryRaw<{ d: string; v: Prisma.Decimal }[]>`SELECT ${sqlDay(Prisma.sql`"at"`)} AS d, COALESCE(SUM(amount),0) AS v FROM payments WHERE "isCancelled" = false AND "at" >= ${range.start} AND "at" < ${range.end} GROUP BY 1` : empty,
    cash ? db.$queryRaw<{ label: string; v: Prisma.Decimal }[]>`SELECT ${RECEIPT_TYPE_SQL} AS label, COALESCE(SUM(r.amount),0) AS v FROM receipts r WHERE r."isCancelled" = false AND r."at" >= ${range.start} AND r."at" < ${range.end} GROUP BY 1` : empty,
    cash ? db.$queryRaw<{ label: string; v: Prisma.Decimal }[]>`
      SELECT ${PAYMENT_KIND_SQL} AS label, COALESCE(SUM(p.amount),0) AS v FROM payments p
      LEFT JOIN operating_expenses oe ON oe."paymentId" = p.id LEFT JOIN expense_types et ON et.id = oe."expenseTypeId"
      WHERE p."isCancelled" = false AND p."at" >= ${range.start} AND p."at" < ${range.end} GROUP BY 1` : empty,
    cash ? db.receipt.groupBy({ by: ["reviewStatus"], where: rc(range.start, range.end), _count: { _all: true } }) : empty,
    cash ? db.payment.groupBy({ by: ["reviewStatus"], where: rc(range.start, range.end), _count: { _all: true } }) : empty,
    cash ? db.receipt.count({ where: { isCancelled: true, at: { gte: range.start, lt: range.end } } }) : Promise.resolve(0),
    cash ? db.payment.count({ where: { isCancelled: true, at: { gte: range.start, lt: range.end } } }) : Promise.resolve(0),
    book ? db.openingCash.findMany({ where: { periodId: period.id }, select: { cashAccountId: true, amount: true } }) : empty,
    book ? db.cashLedger.groupBy({ by: ["cashAccountId"], where: { periodId: period.id }, _sum: { amountIn: true, amountOut: true } }) : empty,
    book ? db.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }) : empty,
    debt ? partnerBalances(db, actor, period.id) : Promise.resolve([]),
    loadBankReceipts(db, actor, range, bankAccount),
  ]);

  const totalIn = thu, totalOut = chi;
  const openMap = new Map(openingCash.map((r) => [r.cashAccountId, num(r.amount)]));
  const ledgerMap = new Map(ledger.map((r) => [r.cashAccountId, num(r._sum.amountIn) - num(r._sum.amountOut)]));
  const accountBalances = accounts.map((a) => ({ name: a.name, type: a.type, balance: (openMap.get(a.id) ?? 0) + (ledgerMap.get(a.id) ?? 0) }));
  const cashTotal = accountBalances.reduce((s, a) => s + a.balance, 0);
  const receivable = balances.filter((b) => b.balance > 0).sort((a, b) => b.balance - a.balance);
  const payable = balances.filter((b) => b.balance < 0).sort((a, b) => a.balance - b.balance);
  const sumAbs = (rows: { balance: number }[]) => rows.reduce((s, r) => s + Math.abs(r.balance), 0);

  const kpis: Kpi[] = [];
  const drill = (path: string) => `${path}?${bankRangeQuery(range)}`;
  if (cash) {
    kpis.push({ key: "in", label: "Tổng thu", value: totalIn, format: "currency", icon: "wallet", tone: "accent", delta: pctDelta(totalIn, prevThu), href: can(actor.perms, "receipt.manage") ? drill("/accounting/receipts") : undefined });
    kpis.push({ key: "out", label: "Tổng chi", value: totalOut, format: "currency", icon: "banknote", tone: "warning", delta: pctDelta(totalOut, prevChi), deltaInverted: true, href: can(actor.perms, "payment.manage") ? drill("/accounting/payments") : undefined });
    kpis.push({ key: "net", label: "Chênh lệch thu − chi", value: totalIn - totalOut, format: "currency", icon: "scale", tone: totalIn - totalOut >= 0 ? "success" : "danger", caption: "Trong kỳ đang xem" });
  }
  if (book) kpis.push({ key: "cash", label: "Số dư quỹ hiện tại", value: cashTotal, format: "currency", icon: "landmark", tone: "info", href: "/accounting/cashbook", caption: "Tiền mặt + ngân hàng" });
  if (debt) {
    kpis.push({ key: "receivable", label: "Công nợ phải thu", value: sumAbs(receivable), format: "currency", icon: "hand-coins", tone: "danger", href: "/accounting/debts", deltaInverted: true, caption: `Hiện tại · ${receivable.length} đối tác còn nợ` });
    kpis.push({ key: "payable", label: "Công nợ phải trả", value: sumAbs(payable), format: "currency", icon: "coins", tone: "neutral", href: "/accounting/debts", caption: `Hiện tại · ${payable.length} đối tác` });
  }

  const widgets: Widget[] = [];
  if (cash) {
    const inM = byMonth(monthlyIn, (r) => num(r.v)), outM = byMonth(monthlyOut, (r) => num(r.v));
    widgets.push({
      key: "monthly", kind: "bars", title: `Thu – chi theo tháng (${year})`, span: 6, labels: MONTH_LABELS, barFormat: "currency",
      bars: [{ name: "Thu", values: inM, tone: "accent", format: "currency" }, { name: "Chi", values: outM, tone: "warning", format: "currency" }],
      line: { name: "Chênh lệch", values: inM.map((v, i) => v - outM[i]!), tone: "success", format: "currency" },
    });
    widgets.push({
      key: "out-mix", kind: "donut", title: "Cơ cấu chi", span: 3, format: "currency", centerLabel: "Tổng chi", centerValue: totalOut,
      slices: topSlices(chiMix.map((r) => ({ label: r.label, value: num(r.v) })), 5),
    });
    widgets.push({
      key: "in-mix", kind: "donut", title: "Cơ cấu thu", span: 3, format: "currency", centerLabel: "Tổng thu", centerValue: totalIn,
      slices: topSlices(thuMix.map((r) => ({ label: r.label, value: num(r.v) })), 5),
    });
  }
  if (debt) {
    widgets.push({
      key: "receivable", kind: "table", title: "Công nợ phải thu khách hàng", span: 6, moreHref: "/accounting/debts",
      columns: [{ label: "Mã KH" }, { label: "Tên khách hàng" }, { label: "Số dư", align: "right" }],
      rows: receivable.slice(0, 5).map((b) => [cell(b.code, { href: `/sales/customers/${b.id}` }), cell(b.name), cell(formatCurrency(b.balance), { align: "right" })]),
    });
    widgets.push({
      key: "payable", kind: "table", title: "Công nợ phải trả nhà cung cấp", span: 6, moreHref: "/accounting/debts",
      columns: [{ label: "Mã NCC" }, { label: "Tên nhà cung cấp" }, { label: "Số dư", align: "right" }],
      rows: payable.slice(0, 5).map((b) => [cell(b.code, { href: `/purchase/suppliers/${b.id}` }), cell(b.name), cell(formatCurrency(Math.abs(b.balance)), { align: "right" })]),
    });
  }
  if (cash && days) {
    widgets.push({
      key: "daily", kind: "bars", title: "Thu chi tiền theo ngày", span: 7, labels: days.map((d) => d.label), barFormat: "currency",
      bars: [{ name: "Thu", values: byDay(days, dailyIn, (r) => num(r.v)), tone: "accent", format: "currency" }, { name: "Chi", values: byDay(days, dailyOut, (r) => num(r.v)), tone: "warning", format: "currency" }],
    });
  }
  if (cash) {
    const review = (s: string) => [...rcReview, ...pmReview].filter((r) => r.reviewStatus === s).reduce((t, r) => t + r._count._all, 0);
    widgets.push({
      key: "review", kind: "status", title: "Tình hình hậu kiểm chứng từ", span: cash && days ? 5 : 12, moreHref: can(actor.perms, "cash.review") ? drill("/accounting/cash-review") : undefined,
      items: [
        { label: "Đã hậu kiểm", value: review("REVIEWED"), tone: "success", icon: "list-checks" },
        { label: "Chờ hậu kiểm", value: review("PENDING_REVIEW"), tone: "warning", icon: "calendar-check" },
        { label: "Bị trả lại", value: review("RETURNED"), tone: "danger", icon: "undo-2" },
        { label: "Đã hủy", value: rcCancel + pmCancel, tone: "neutral", icon: "trash-2" },
      ],
    });
  }
  if (book) {
    widgets.push({
      key: "accounts", kind: "table", title: "Số dư theo quỹ / tài khoản", span: 12, moreHref: "/accounting/cashbook",
      columns: [{ label: "Quỹ / tài khoản" }, { label: "Loại" }, { label: "Số dư", align: "right" }],
      rows: accountBalances.map((a) => [cell(a.name), cell(a.type === "CASH" ? "Tiền mặt" : "Ngân hàng"), cell(formatCurrency(a.balance), { align: "right", tone: a.balance < 0 ? "danger" : undefined })]),
    });
  }
  return { kpis, widgets, bankReceipts };
}
