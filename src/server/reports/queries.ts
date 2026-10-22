import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import { canViewOrderAnalysis } from "@/lib/permissions/order-analysis";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { resolveTimeRange, timeRangeWhere, type TimeRange } from "@/lib/time-presets";
import { DomainError } from "@/server/http/errors";
import { actualConsumption, consumptionCompare, productionReport } from "./consumption";
import { REPORTS, type ReportKey, type ReportResult } from "./types";
import { grossOf } from "@/server/sales/queries";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const r2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const ymd = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
/** Mặc định “tháng này” khi chưa chọn khoảng thời gian. */
export function reportRange(params: ListParams, now: Date = new Date()): TimeRange {
  const r = resolveTimeRange(params.timePreset ?? "thisMonth", now, { start: params.timeStart, end: params.timeEnd });
  return r ?? resolveTimeRange("thisMonth", now)!;
}
const lineNet = (l: { qty: Prisma.Decimal; salePrice: Prisma.Decimal; discountNow: Prisma.Decimal }) => grossOf(l.qty, l.salePrice).minus(l.discountNow);

async function liveOrders(db: Db, actor: Actor, range: TimeRange, customerIds?: number[]) {
  return db.saleOrder.findMany({
    where: { isCancelled: false, isDraft: false, orderDate: timeRangeWhere(range), partner: partnerScopeWhere(actor), ...(customerIds ? { partnerId: { in: customerIds } } : {}) },
    orderBy: [{ orderDate: "desc" }, { id: "desc" }],
    select: { id: true, code: true, orderDate: true, partner: { select: { id: true, code: true, name: true, group: { select: { name: true } } } }, lines: { select: { id: true, qty: true, salePrice: true, discountNow: true, discountAccum: true, unitCostFifo: true, qtyBase: true, isProvisional: true } } },
  });
}
const orderFigures = (lines: Awaited<ReturnType<typeof liveOrders>>[number]["lines"]) => {
  const revenue = lines.reduce((s, l) => s.plus(lineNet(l)), D(0));
  const accum = lines.reduce((s, l) => s.plus(l.discountAccum), D(0));
  const cost = lines.reduce((s, l) => s.plus(l.unitCostFifo.times(l.qtyBase)), D(0));
  return { revenue: r2(revenue), accum: r2(accum), cost: r2(cost), profit: r2(revenue.minus(accum).minus(cost)), provisional: lines.some((l) => l.isProvisional) };
};
const pct = (profit: Prisma.Decimal, revenue: Prisma.Decimal) => (revenue.isZero() ? null : Number(profit.div(revenue).times(100).toFixed(1)));

/** 67 — Lãi từng đơn = thành tiền (sau CK trừ ngay) − CK tích lũy − giá vốn FIFO. Đơn thiếu tồn (giá vốn chưa chốt) đánh dấu. Lãi âm bôi đỏ. */
async function orderProfit(db: Db, actor: Actor, params: ListParams, range: TimeRange): Promise<ReportResult> {
  const customerIds = params.filters.customer?.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  const [orders, customers] = await Promise.all([
    liveOrders(db, actor, range, customerIds),
    db.partner.findMany({ where: { isCustomer: true, ...partnerScopeWhere(actor) }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  const selectedId = Number(params.filters.order?.[0]);
  const selected = Number.isSafeInteger(selectedId) && selectedId > 0 ? await db.saleOrder.findFirst({
    where: { id: selectedId, isCancelled: false, isDraft: false, partner: partnerScopeWhere(actor) },
    select: { id: true, code: true, orderDate: true, partner: { select: { name: true } }, lines: { orderBy: { id: "asc" }, select: { id: true, qty: true, unit: true, salePrice: true, discountNow: true, discountAccum: true, unitCostFifo: true, qtyBase: true, isProvisional: true, product: { select: { code: true, name: true } } } } },
  }) : null;
  const figures = (f: ReturnType<typeof orderFigures>) => ({ revenue: f.revenue.toString(), accum: f.accum.toString(), cost: f.cost.toString(), profit: f.profit.toString(), margin: pct(f.profit, f.revenue), note: f.provisional ? "Giá vốn tạm do thiếu tồn; lãi có thể thay đổi khi chốt giá vốn." : "" });
  let rows = orders.map((o) => { const f = orderFigures(o.lines); return { o, f }; });
  if (params.filters.neg?.[0] === "1") rows = rows.filter((x) => x.f.profit.lt(0));
  const q = (params.q ?? "").trim().toLowerCase();
  if (q) rows = rows.filter((x) => x.o.code.toLowerCase().includes(q) || x.o.partner.name.toLowerCase().includes(q) || x.o.partner.code.toLowerCase().includes(q));
  const tot = rows.reduce((s, x) => ({ rev: s.rev.plus(x.f.revenue), acc: s.acc.plus(x.f.accum), cost: s.cost.plus(x.f.cost), profit: s.profit.plus(x.f.profit) }), { rev: D(0), acc: D(0), cost: D(0), profit: D(0) });
  return {
    key: "order-profit", title: "Lãi từng đơn", negativeKey: "profit", total: rows.length,
    customers: customers.map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` })),
    orderDetail: selected ? { id: selected.id, code: selected.code, date: ymd(selected.orderDate), customer: selected.partner.name, figures: figures(orderFigures(selected.lines)), lines: selected.lines.map((l) => ({ id: l.id, code: l.product.code, name: l.product.name, qty: l.qty.toString(), unit: l.unit, price: l.salePrice.toString(), discountNow: l.discountNow.toString(), ...figures(orderFigures([l])) })) } : null,
    columns: [{ key: "code", label: "Đơn", kind: "text" }, { key: "date", label: "Ngày", kind: "date" }, { key: "customer", label: "Khách", kind: "text" }, { key: "revenue", label: "Doanh thu", kind: "money" }, { key: "accum", label: "CK tích lũy", kind: "money" }, { key: "cost", label: "Giá vốn", kind: "money" }, { key: "profit", label: "Lãi", kind: "money" }, { key: "margin", label: "% lãi", kind: "pct" }, { key: "note", label: "Ghi chú", kind: "text", align: "left" }],
    rows: rows.map(({ o, f }) => ({ id: o.id, code: o.code, date: ymd(o.orderDate), customer: o.partner.name, revenue: f.revenue.toString(), accum: f.accum.toString(), cost: f.cost.toString(), profit: f.profit.toString(), margin: pct(f.profit, f.revenue), note: f.provisional ? "Có dòng thiếu tồn (giá vốn tạm)" : "" })),
    totals: { code: "Tổng", revenue: tot.rev.toString(), accum: tot.acc.toString(), cost: tot.cost.toString(), profit: tot.profit.toString(), margin: pct(tot.profit, tot.rev) },
    notes: ["Chưa trừ giá trị hàng khách trả; chưa cộng CK chuyển vào lãi công ty (xem Lãi lỗ toàn xưởng)."],
  };
}

/** 68 — Lãi lỗ toàn xưởng theo tháng: DT − hàng trả + vốn hàng trả − giá vốn − CK tích lũy − chi phí hoạt động. */
async function periodPnl(db: Db, actor: Actor, _params: ListParams, range: TimeRange): Promise<ReportResult> {
  const [orders, returns, expenses, forfeits] = await Promise.all([
    liveOrders(db, actor, range),
    db.goodsReturn.findMany({ where: { isCancelled: false, kind: { not: "SUPPLIER" }, at: timeRangeWhere(range), partner: partnerScopeWhere(actor) }, select: { id: true, at: true, totalAmount: true, lines: { select: { discountAccumReversed: true } } } }),
    db.operatingExpense.findMany({ where: { payment: { isCancelled: false, at: timeRangeWhere(range) } }, select: { payment: { select: { at: true, amount: true } } } }),
    db.discountSettlement.findMany({ where: { method: "FORFEIT", isCancelled: false, at: timeRangeWhere(range), partner: partnerScopeWhere(actor) }, select: { at: true, amount: true } }),
  ]);
  const layers = returns.length ? await db.costLayer.findMany({ where: { sourceDocType: "RETURN_IN", sourceDocId: { in: returns.map((r) => r.id) } }, select: { sourceDocId: true, qtyIn: true, unitCost: true } }) : [];
  const m = new Map<string, { rev: Prisma.Decimal; ret: Prisma.Decimal; retCost: Prisma.Decimal; cost: Prisma.Decimal; acc: Prisma.Decimal; exp: Prisma.Decimal; fo: Prisma.Decimal }>();
  const get = (k: string) => { let v = m.get(k); if (!v) { v = { rev: D(0), ret: D(0), retCost: D(0), cost: D(0), acc: D(0), exp: D(0), fo: D(0) }; m.set(k, v); } return v; };
  for (const o of orders) { const f = orderFigures(o.lines); const v = get(ymd(o.orderDate).slice(0, 7)); v.rev = v.rev.plus(f.revenue); v.cost = v.cost.plus(f.cost); v.acc = v.acc.plus(f.accum); }
  const retMonth = new Map(returns.map((r) => [r.id, ymd(r.at).slice(0, 7)]));
  for (const r of returns) { const v = get(ymd(r.at).slice(0, 7)); v.ret = v.ret.plus(r.totalAmount); v.acc = v.acc.minus(r.lines.reduce((s, l) => s.plus(l.discountAccumReversed), D(0))); }
  for (const l of layers) { const v = get(retMonth.get(l.sourceDocId)!); v.retCost = v.retCost.plus(l.qtyIn.times(l.unitCost)); }
  for (const e of expenses) { const v = get(ymd(e.payment.at).slice(0, 7)); v.exp = v.exp.plus(e.payment.amount); }
  for (const f of forfeits) { const v = get(ymd(f.at).slice(0, 7)); v.fo = v.fo.plus(f.amount); }
  const rows = [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, v]) => {
    const net = v.rev.minus(v.ret); const cost = v.cost.minus(v.retCost); const gross = net.minus(cost).minus(v.acc).plus(v.fo); const profit = gross.minus(v.exp);
    return { month: `${month.slice(5)}/${month.slice(0, 4)}`, revenue: v.rev.toString(), returns: v.ret.toString(), cost: r2(cost).toString(), accum: r2(v.acc).toString(), forfeit: v.fo.toString(), gross: r2(gross).toString(), expense: v.exp.toString(), profit: r2(profit).toString() };
  });
  const S = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s.plus(r[k] as string), D(0)).toString();
  return {
    key: "period-pnl", title: "Lãi lỗ toàn xưởng", negativeKey: "profit", total: rows.length,
    columns: [{ key: "month", label: "Tháng", kind: "text" }, { key: "revenue", label: "Doanh thu", kind: "money" }, { key: "returns", label: "Hàng trả", kind: "money" }, { key: "cost", label: "Giá vốn (đã trừ vốn hàng trả)", kind: "money" }, { key: "accum", label: "CK tích lũy", kind: "money" }, { key: "forfeit", label: "CK chuyển vào lãi", kind: "money" }, { key: "gross", label: "Lãi gộp", kind: "money" }, { key: "expense", label: "Chi phí hoạt động", kind: "money" }, { key: "profit", label: "Lãi ròng", kind: "money" }],
    rows, totals: { month: "Tổng", revenue: S("revenue"), returns: S("returns"), cost: S("cost"), accum: S("accum"), forfeit: S("forfeit"), gross: S("gross"), expense: S("expense"), profit: S("profit") },
    summary: [{ label: "Doanh thu", value: S("revenue"), money: true }, { label: "Lãi gộp", value: S("gross"), money: true, tone: D(S("gross")).lt(0) ? "danger" : "success" }, { label: "Chi phí hoạt động", value: S("expense"), money: true }, { label: "Lãi ròng", value: S("profit"), money: true, tone: D(S("profit")).lt(0) ? "danger" : "success" }],
    notes: ["Lãi ròng = doanh thu − hàng trả − giá vốn (đã cộng lại vốn hàng trả) − CK tích lũy + CK chuyển vào lãi − chi phí hoạt động.", "CK chuyển vào lãi = phần chiết khấu tích lũy khách không nhận, được tất toán \"Chuyển vào lãi công ty\" (tính theo ngày phiếu, bỏ phiếu đã hủy).", "Chi phí tính theo phiếu chi CHI_PHI chưa hủy (kể cả chưa kiểm tra)."],
  };
}

async function salesBy(db: Db, actor: Actor, range: TimeRange, by: "customer" | "group", params: ListParams): Promise<ReportResult> {
  const customerIds = by === "customer" ? params.filters.customer?.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : undefined;
  const [orders, returns] = await Promise.all([
    liveOrders(db, actor, range, customerIds),
    db.goodsReturn.findMany({ where: { isCancelled: false, kind: { not: "SUPPLIER" }, at: timeRangeWhere(range), partner: partnerScopeWhere(actor), ...(customerIds ? { partnerId: { in: customerIds } } : {}) }, select: { totalAmount: true, partner: { select: { id: true, code: true, name: true, group: { select: { name: true } } } } } }),
  ]);
  const customers = by === "customer" ? await db.partner.findMany({ where: { isCustomer: true, ...partnerScopeWhere(actor) }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }) : undefined;
  const keyOf = (p: { id: number; code: string; name: string; group: { name: string } }) => (by === "customer" ? `${p.id}|${p.code}|${p.name}` : p.group.name);
  const m = new Map<string, { orders: number; rev: Prisma.Decimal; acc: Prisma.Decimal; ret: Prisma.Decimal; code: string; name: string }>();
  const get = (p: Parameters<typeof keyOf>[0]) => { const k = keyOf(p); let v = m.get(k); if (!v) { v = { orders: 0, rev: D(0), acc: D(0), ret: D(0), code: by === "customer" ? p.code : "", name: by === "customer" ? p.name : p.group.name }; m.set(k, v); } return v; };
  for (const o of orders) { const f = orderFigures(o.lines); const v = get(o.partner); v.orders++; v.rev = v.rev.plus(f.revenue); v.acc = v.acc.plus(f.accum); }
  for (const r of returns) { const v = get(r.partner); v.ret = v.ret.plus(r.totalAmount); }
  const q = (params.q ?? "").trim().toLowerCase();
  const list = [...m.values()].filter((v) => !q || v.name.toLowerCase().includes(q) || v.code.toLowerCase().includes(q)).sort((a, b) => b.rev.minus(b.ret).comparedTo(a.rev.minus(a.ret)));
  const tot = list.reduce((s, v) => ({ orders: s.orders + v.orders, rev: s.rev.plus(v.rev), ret: s.ret.plus(v.ret), acc: s.acc.plus(v.acc) }), { orders: 0, rev: D(0), ret: D(0), acc: D(0) });
  const cols = by === "customer" ? [{ key: "code", label: "Mã", kind: "text" as const }, { key: "name", label: "Khách hàng", kind: "text" as const }] : [{ key: "name", label: "Nhóm khách", kind: "text" as const }];
  return {
    key: by === "customer" ? "by-customer" : "by-group", title: by === "customer" ? "Bán hàng theo khách" : "Bán hàng theo nhóm khách", total: list.length,
    customers: customers?.map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` })),
    summary: [{ label: by === "customer" ? "Khách hàng" : "Nhóm khách hàng", value: list.length }, { label: "Số đơn", value: tot.orders }, { label: "Doanh thu", value: tot.rev.toString(), money: true }, { label: "Doanh thu thuần", value: tot.rev.minus(tot.ret).toString(), money: true, tone: tot.rev.minus(tot.ret).lt(0) ? "danger" : "neutral" }],
    columns: [...cols, { key: "orders", label: "Số đơn", kind: "int" }, { key: "revenue", label: "Doanh thu", kind: "money" }, { key: "returns", label: "Hàng trả", kind: "money" }, { key: "net", label: "Doanh thu thuần", kind: "money" }, { key: "accum", label: "CK tích lũy", kind: "money" }],
    rows: list.map((v) => ({ code: v.code, name: v.name, orders: v.orders, revenue: v.rev.toString(), returns: v.ret.toString(), net: v.rev.minus(v.ret).toString(), accum: v.acc.toString() })),
    totals: { [by === "customer" ? "name" : "name"]: "Tổng", orders: tot.orders, revenue: tot.rev.toString(), returns: tot.ret.toString(), net: tot.rev.minus(tot.ret).toString(), accum: tot.acc.toString() },
  };
}

/** 71 — Xuất kho theo đơn: từng dòng hàng (và NVL của dòng gia công); giá vốn chỉ hiện với người có cost.view. */
async function issueByOrder(db: Db, actor: Actor, params: ListParams, range: TimeRange): Promise<ReportResult> {
  const showDetails = canViewOrderAnalysis(actor.perms);
  const showCost = showDetails && actor.perms.has("cost.view");
  const q = (params.q ?? "").trim();
  const orders = await db.saleOrder.findMany({
    where: { isCancelled: false, isDraft: false, orderDate: timeRangeWhere(range), partner: partnerScopeWhere(actor), ...(q ? { OR: [{ code: { contains: q.toUpperCase() } }, { partner: { name: { contains: q, mode: "insensitive" } } }] } : {}) },
    orderBy: [{ orderDate: "desc" }, { id: "desc" }], take: 500,
    select: { code: true, orderDate: true, partner: { select: { name: true } }, lines: { orderBy: { id: "asc" }, select: { qty: true, unit: true, qtyBase: true, unitCostFifo: true, isProvisional: true, product: { select: { code: true, name: true, baseUnit: true } }, processingType: { select: { name: true } }, issues: { select: { qtyBase: true, product: { select: { code: true, name: true, baseUnit: true } } } } } } },
  });
  const rows: Record<string, string | number | null>[] = [];
  for (const o of orders) for (const l of o.lines) {
    const base = { order: o.code, date: ymd(o.orderDate), customer: o.partner.name };
    if (showDetails && l.processingType && l.issues.length) for (const i of l.issues) rows.push({ ...base, code: i.product.code, name: `${i.product.name} (NVL cho ${l.product.code})`, qty: i.qtyBase.toString(), unit: i.product.baseUnit, cost: null, note: l.processingType.name });
    else rows.push({ ...base, code: l.product.code, name: l.product.name, qty: l.qtyBase.toString(), unit: l.product.baseUnit, cost: showCost ? r2(l.unitCostFifo.times(l.qtyBase)).toString() : null, note: l.isProvisional ? "Thiếu tồn (giá vốn tạm)" : "" });
  }
  return {
    key: "issue-by-order", title: "Xuất kho theo đơn", total: rows.length,
    summary: [{ label: "Số đơn xuất kho", value: orders.length }, { label: "Dòng hàng / NVL", value: rows.length }, { label: "Mã hàng / NVL", value: new Set(rows.map((r) => r.code)).size }, ...(showCost ? [{ label: "Giá vốn đã ghi nhận", value: rows.reduce((s, r) => s.plus(r.cost ?? 0), D(0)).toString(), money: true }] : [])],
    columns: [{ key: "order", label: "Đơn", kind: "text" }, { key: "date", label: "Ngày", kind: "date" }, { key: "customer", label: "Khách", kind: "text" }, { key: "code", label: "Mã", kind: "text" }, { key: "name", label: "Hàng hóa / NVL", kind: "text" }, { key: "qty", label: "SL (đơn vị gốc)", kind: "qty" }, { key: "unit", label: "ĐVT", kind: "text" }, ...(showCost ? [{ key: "cost", label: "Giá vốn", kind: "money" as const }] : []), { key: "note", label: "Ghi chú", kind: "text" as const }],
    rows, notes: orders.length === 500 ? ["Chỉ hiện 500 đơn mới nhất trong khoảng thời gian — thu hẹp bộ lọc để xem đủ."] : undefined,
  };
}

/** 73 — Đối chiếu công nợ: sổ công nợ so với chứng từ nguồn theo từng loại; dòng sổ mồ côi; số dư chiết khấu âm. */
async function debtReconciliation(db: Db): Promise<ReportResult> {
  const sum = (v: Prisma.Decimal | null | undefined) => v ?? D(0);
  const [ledger, receipts, payments, purchases, returns, adjs, orphans, negDiscount] = await Promise.all([
    db.partnerLedger.groupBy({ by: ["docType"], _sum: { debit: true, credit: true }, _count: { _all: true } }),
    db.receipt.aggregate({ where: { isCancelled: false, partnerId: { not: null }, tripId: null }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { isCancelled: false, kind: { in: ["TRA_NCC", "HOAN_KHACH"] } }, _sum: { amount: true } }),
    db.purchase.aggregate({ where: { isCancelled: false }, _sum: { purchaseTotal: true } }),
    db.goodsReturn.aggregate({ where: { isCancelled: false }, _sum: { totalAmount: true } }),
    db.debtAdjustment.aggregate({ where: { isCancelled: false }, _sum: { amount: true } }),
    db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM partner_ledger pl WHERE (pl."docType" = 'DELIVERY' AND NOT EXISTS (SELECT 1 FROM delivery_notes d WHERE d.id = pl."docId" AND NOT d."isCancelled")) OR (pl."docType" = 'RECEIPT' AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.id = pl."docId" AND NOT r."isCancelled")) OR (pl."docType" = 'PAYMENT' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = pl."docId" AND NOT p."isCancelled")) OR (pl."docType" = 'PURCHASE' AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.id = pl."docId" AND NOT p."isCancelled"))`,
    db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM (SELECT "partnerId" FROM discount_ledger GROUP BY "partnerId" HAVING sum("amountIn") - sum("amountOut") < 0) x`,
  ]);
  const by = new Map(ledger.map((l) => [l.docType, l]));
  const led = (t: string, side: "debit" | "credit") => sum(by.get(t)?._sum[side]);
  const line = (id: string, label: string, ledgerAmt: Prisma.Decimal, source: Prisma.Decimal | null, note: string) => ({ id, item: label, ledger: ledgerAmt.toString(), source: source === null ? null : source.toString(), diff: source === null ? null : ledgerAmt.minus(source).toString(), note });
  const rows = [
    line("receipt", "Phiếu thu (ghi có, không tính tiền lái xe/chuyến)", led("RECEIPT", "credit"), sum(receipts._sum.amount), "Sổ = Σ phiếu thu có đối tác chưa hủy"),
    line("payment", "Phiếu chi trả NCC / hoàn khách (ghi nợ)", led("PAYMENT", "debit"), sum(payments._sum.amount), "Chưa tính dòng điều chỉnh sau kiểm"),
    line("purchase", "Phiếu nhập (ghi có NCC)", led("PURCHASE", "credit"), sum(purchases._sum.purchaseTotal), "Sổ = Σ tổng phiếu nhập chưa hủy"),
    line("return", "Trả hàng (ghi có)", led("RETURN", "credit").plus(led("RETURN", "debit")), sum(returns._sum.totalAmount), "Gồm trả khách (ghi có) và trả NCC (ghi nợ)"),
    line("debt-adj", "Điều chỉnh công nợ (ròng)", led("DEBT_ADJ", "debit").minus(led("DEBT_ADJ", "credit")), sum(adjs._sum.amount), "Số có dấu: tăng nợ +, giảm nợ −"),
    line("delivery", "Phiếu giao (ghi nợ khách)", led("DELIVERY", "debit"), null, "Đối chiếu theo từng đơn ở màn Công nợ"),
    line("trip-collect", "Tiền lái xe thu (ghi có)", led("TRIP_COLLECT", "credit"), null, "Chuyển thành phiếu thu khi thủ quỹ xác nhận chuyến"),
    line("trip-discount", "Tiền bớt khi giao chuyến (ghi có)", led("TRIP_DISCOUNT", "credit"), null, "Lái xe giao hàng, khách được bớt — không vào quỹ"),
    line("discount-settle", "Tất toán chiết khấu trừ nợ (ghi có)", led("DISCOUNT_SETTLE", "credit"), null, ""),
  ];
  const bad = rows.filter((r) => r.diff !== null && !D(r.diff).isZero()).length;
  return {
    key: "debt-reconciliation", title: "Đối chiếu công nợ", total: rows.length, negativeKey: "diff",
    summary: [{ label: "Khoản mục đối chiếu", value: rows.filter((r) => r.diff !== null).length }, { label: "Khoản mục khớp", value: rows.filter((r) => r.diff !== null && D(r.diff).isZero()).length, tone: "success" }, { label: "Khoản mục lệch", value: bad, tone: bad ? "danger" : "neutral" }, { label: "Tổng lệch tuyệt đối", value: rows.reduce((s, r) => s.plus(r.diff === null ? 0 : D(r.diff).abs()), D(0)).toString(), money: true, tone: bad ? "danger" : "neutral" }],
    columns: [{ key: "item", label: "Khoản mục", kind: "text" }, { key: "ledger", label: "Theo sổ công nợ", kind: "money" }, { key: "source", label: "Theo chứng từ", kind: "money" }, { key: "diff", label: "Chênh lệch", kind: "money" }, { key: "note", label: "Ghi chú", kind: "text" }],
    rows, notes: [`Dòng sổ công nợ mồ côi (chứng từ đã hủy/không còn): ${orphans[0]?.n ?? 0}`, `Khách có số dư chiết khấu tích lũy âm: ${negDiscount[0]?.n ?? 0}`, bad === 0 ? "Các khoản mục có chứng từ nguồn đều khớp." : `Có ${bad} khoản mục lệch — kiểm tra chứng từ tương ứng.`],
  };
}

export async function runReport(db: Db, actor: Actor, key: string, params: ListParams, now: Date = new Date()): Promise<ReportResult & { range: { start: Date; end: Date } }> {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw new DomainError("Không tìm thấy báo cáo.", 404);
  assertCan(actor.perms, def.perm);
  if (key === "order-profit" || key === "period-pnl") {
    assertCan(actor.perms, "order.analysis.view");
    assertCan(actor.perms, "profit.view");
  }
  const range = reportRange(params, now);
  const k = key as ReportKey;
  const res = k === "order-profit" ? await orderProfit(db, actor, params, range)
    : k === "period-pnl" ? await periodPnl(db, actor, params, range)
    : k === "by-customer" ? await salesBy(db, actor, range, "customer", params)
    : k === "by-group" ? await salesBy(db, actor, range, "group", params)
    : k === "issue-by-order" ? await issueByOrder(db, actor, params, range)
    : k === "production" ? await productionReport(db, range, actor.perms.has("cost.view"))
    : k === "actual-consumption" ? await actualConsumption(db, range)
    : k === "consumption-compare" ? await consumptionCompare(db, range, params.filters.neg?.[0] === "1")
    : await debtReconciliation(db);
  return { ...res, range };
}
