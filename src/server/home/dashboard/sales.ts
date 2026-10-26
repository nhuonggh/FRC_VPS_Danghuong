import { Prisma } from "@prisma/client";
import { formatCurrency, formatDate } from "@/lib/format";
import { can } from "@/lib/permissions/guard";
import { grossAmount, roundUpThousand } from "@/lib/line-amount";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { getOpenPeriod } from "@/server/period/guard";
import { DELIVERY_LABEL } from "@/server/sales/status";
import {
  byMonth, cell, KIND_LABEL, MONTH_LABELS, num, partnerBalances, pctDelta, sqlMonth, sqlPartnerScope, topSlices,
  yearBounds, yearOfRange, type Db, type DashRange,
} from "./common";
import type { Dashboard, Kpi, Widget } from "./types";

// Doanh thu dòng = qty × giá bán (làm tròn 2, lên nghìn đồng nếu đơn bật làm tròn `roundAmounts`) − chiết khấu đợt này — đúng `lineAmountOf` ở src/server/sales/queries.ts.
const LINE_AMOUNT = Prisma.sql`(CASE WHEN o."roundAmounts" THEN CEIL(ROUND(l.qty * l."salePrice", 2) / 1000) * 1000 ELSE ROUND(l.qty * l."salePrice", 2) END) - l."discountNow"`;
const VALID = Prisma.sql`o."isCancelled" = false AND o."isDraft" = false`;

async function totals(db: Db, actor: Actor, from: Date, to: Date) {
  const [row] = await db.$queryRaw<{ revenue: Prisma.Decimal; orders: number }[]>`
    SELECT COALESCE(SUM(${LINE_AMOUNT}), 0) AS revenue, COUNT(DISTINCT o.id)::int AS orders
    FROM sale_orders o JOIN sale_order_lines l ON l."orderId" = o.id JOIN partners p ON p.id = o."partnerId"
    WHERE ${VALID} AND o."orderDate" >= ${from} AND o."orderDate" < ${to} ${sqlPartnerScope(actor)}`;
  return { revenue: num(row?.revenue), orders: row?.orders ?? 0 };
}

export async function loadSales(db: Db, actor: Actor, range: DashRange): Promise<Dashboard> {
  const money = can(actor.perms, "sale_price.view");
  const scope = partnerScopeWhere(actor);
  const period = await getOpenPeriod(db);
  const year = yearOfRange(range), yb = yearBounds(year);

  const [cur, prev, monthly, byKind, topCustomers, recent, newCustomers, prevNewCustomers, statusRows, payRows, balances] = await Promise.all([
    totals(db, actor, range.start, range.end),
    totals(db, actor, range.prevStart, range.prevEnd),
    db.$queryRaw<{ m: number; revenue: Prisma.Decimal; orders: number }[]>`
      SELECT ${sqlMonth(Prisma.sql`o."orderDate"`)} AS m, COALESCE(SUM(${LINE_AMOUNT}), 0) AS revenue, COUNT(DISTINCT o.id)::int AS orders
      FROM sale_orders o JOIN sale_order_lines l ON l."orderId" = o.id JOIN partners p ON p.id = o."partnerId"
      WHERE ${VALID} AND o."orderDate" >= ${yb.start} AND o."orderDate" < ${yb.end} ${sqlPartnerScope(actor)} GROUP BY 1`,
    money ? db.$queryRaw<{ kind: string; revenue: Prisma.Decimal }[]>`
      SELECT pr.kind::text AS kind, COALESCE(SUM(${LINE_AMOUNT}), 0) AS revenue
      FROM sale_orders o JOIN sale_order_lines l ON l."orderId" = o.id JOIN products pr ON pr.id = l."productId" JOIN partners p ON p.id = o."partnerId"
      WHERE ${VALID} AND o."orderDate" >= ${range.start} AND o."orderDate" < ${range.end} ${sqlPartnerScope(actor)} GROUP BY 1` : Promise.resolve([]),
    money ? db.$queryRaw<{ id: number; name: string; revenue: Prisma.Decimal }[]>`
      SELECT p.id, p.name, COALESCE(SUM(${LINE_AMOUNT}), 0) AS revenue
      FROM sale_orders o JOIN sale_order_lines l ON l."orderId" = o.id JOIN partners p ON p.id = o."partnerId"
      WHERE ${VALID} AND o."orderDate" >= ${range.start} AND o."orderDate" < ${range.end} ${sqlPartnerScope(actor)}
      GROUP BY p.id, p.name ORDER BY revenue DESC LIMIT 5` : Promise.resolve([]),
    db.saleOrder.findMany({
      where: { partner: scope }, orderBy: [{ orderDate: "desc" }, { id: "desc" }], take: 5,
      select: { id: true, code: true, orderDate: true, isCancelled: true, isDraft: true, deliveryStatus: true, roundAmounts: true, roundTotal: true, roundNearest: true, partner: { select: { name: true } }, lines: { select: { qty: true, salePrice: true, discountNow: true } } },
    }),
    db.partner.count({ where: { ...scope, isCustomer: true, createdAt: { gte: range.start, lt: range.end } } }),
    db.partner.count({ where: { ...scope, isCustomer: true, createdAt: { gte: range.prevStart, lt: range.prevEnd } } }),
    db.saleOrder.groupBy({ by: ["deliveryStatus", "isCancelled"], where: { partner: scope, isDraft: false, orderDate: { gte: range.start, lt: range.end } }, _count: { _all: true } }),
    db.saleOrder.groupBy({ by: ["paymentStatus"], where: { partner: scope, isDraft: false, isCancelled: false, orderDate: { gte: range.start, lt: range.end } }, _count: { _all: true } }),
    money ? partnerBalances(db, actor, period.id) : Promise.resolve([]),
  ]);

  const receivable = balances.filter((b) => b.balance > 0).reduce((s, b) => s + b.balance, 0);

  const kpis: Kpi[] = [];
  if (money) kpis.push({ key: "revenue", label: "Doanh thu bán hàng", value: cur.revenue, format: "currency", icon: "bar-chart-3", tone: "accent", delta: pctDelta(cur.revenue, prev.revenue) });
  kpis.push({ key: "orders", label: "Số đơn hàng", value: cur.orders, format: "count", icon: "shopping-cart", tone: "success", delta: pctDelta(cur.orders, prev.orders), href: "/sales/orders" });
  kpis.push({ key: "new-customers", label: "Khách hàng mới", value: newCustomers, format: "count", icon: "users", tone: "warning", delta: pctDelta(newCustomers, prevNewCustomers), href: "/sales/customers" });
  if (money) kpis.push({ key: "receivable", label: "Công nợ phải thu", value: receivable, format: "currency", icon: "hand-coins", tone: "danger", deltaInverted: true, caption: "Hiện tại, toàn bộ khách", href: "/accounting/debts" });

  const widgets: Widget[] = [];
  widgets.push({
    key: "monthly", kind: "bars", title: `Doanh thu theo tháng (${year})`, span: 8, labels: MONTH_LABELS, barFormat: money ? "currency" : "count",
    bars: money ? [{ name: "Doanh thu", values: byMonth(monthly, (r) => num(r.revenue)), tone: "accent", format: "currency" }] : [{ name: "Số đơn hàng", values: byMonth(monthly, (r) => r.orders), tone: "info", format: "count" }],
    ...(money ? { line: { name: "Số đơn hàng", values: byMonth(monthly, (r) => r.orders), tone: "info" as const, format: "count" as const } } : {}),
  });
  if (money) {
    widgets.push({
      key: "by-kind", kind: "donut", title: "Cơ cấu doanh thu theo nhóm hàng", span: 4, format: "currency", centerLabel: "Doanh thu", centerValue: cur.revenue,
      slices: topSlices(byKind.map((r) => ({ label: KIND_LABEL[r.kind] ?? r.kind, value: num(r.revenue) })), 5),
    });
  }
  widgets.push({
    key: "recent", kind: "table", title: "Đơn hàng gần đây", span: money ? 8 : 12, moreHref: "/sales/orders",
    columns: [{ label: "Mã đơn" }, { label: "Ngày đặt" }, { label: "Khách hàng" }, ...(money ? [{ label: "Tổng tiền", align: "right" as const }] : []), { label: "Trạng thái" }],
    rows: recent.map((o) => {
      const net = o.lines.reduce((s, l) => s + grossAmount(num(l.qty), num(l.salePrice), o.roundAmounts) - num(l.discountNow), 0), total = o.roundTotal ? (o.roundNearest ? Math.round(net / 1000) * 1000 : roundUpThousand(net)) : net;
      const st = o.isCancelled ? { text: "Đã hủy", tone: "danger" as const } : o.isDraft ? { text: "Nháp", tone: "neutral" as const } : { text: DELIVERY_LABEL[o.deliveryStatus].label, tone: DELIVERY_LABEL[o.deliveryStatus].tone === "neutral" ? ("neutral" as const) : DELIVERY_LABEL[o.deliveryStatus].tone };
      return [cell(o.code, { href: `/sales/orders/${o.id}` }), cell(formatDate(o.orderDate)), cell(o.partner.name), ...(money ? [cell(formatCurrency(total), { align: "right" })] : []), cell(st.text, { tone: st.tone })];
    }),
  });
  if (money) {
    widgets.push({
      key: "top-customers", kind: "rank", title: "Top khách hàng theo doanh thu", span: 4, format: "currency", moreHref: "/sales/customers",
      items: topCustomers.map((c) => ({ label: c.name, value: num(c.revenue), href: `/sales/customers/${c.id}` })),
    });
  }

  const orderStatus = (keys: string[]) => statusRows.filter((r) => !r.isCancelled && keys.includes(r.deliveryStatus)).reduce((s, r) => s + r._count._all, 0);
  widgets.push({
    key: "order-status", kind: "status", title: "Tình trạng đơn hàng", span: 6,
    items: [
      { label: "Đang xử lý", value: orderStatus(["NEW", "WAITING_STOCK", "READY", "LOADED"]), tone: "info", icon: "clipboard-list" },
      { label: "Đang giao", value: orderStatus(["DELIVERING"]), tone: "warning", icon: "truck" },
      { label: "Đã giao", value: orderStatus(["DELIVERED"]), tone: "success", icon: "package" },
      { label: "Giao thiếu / thất bại", value: orderStatus(["PARTIAL", "FAILED"]), tone: "danger", icon: "undo-2" },
      { label: "Đã hủy", value: statusRows.filter((r) => r.isCancelled).reduce((s, r) => s + r._count._all, 0), tone: "neutral", icon: "trash-2" },
    ],
  });
  const pay = (keys: string[]) => payRows.filter((r) => keys.includes(r.paymentStatus)).reduce((s, r) => s + r._count._all, 0);
  widgets.push({
    key: "payment-status", kind: "status", title: "Tình trạng thanh toán", span: 6,
    items: [
      { label: "Chưa thu", value: pay(["UNPAID"]), tone: "neutral", icon: "wallet" },
      { label: "Đã cọc / thu một phần", value: pay(["DEPOSITED", "PARTIAL"]), tone: "info", icon: "hand-coins" },
      { label: "Đã thanh toán", value: pay(["PAID", "OVERPAID"]), tone: "success", icon: "banknote" },
      { label: "Ghi nợ / hẹn trả", value: pay(["DEBT", "PROMISED"]), tone: "warning", icon: "scroll-text" },
    ],
  });

  return { kpis, widgets, notes: money ? undefined : ["Bạn chưa có quyền xem giá bán nên các số liệu tiền được ẩn."] };
}
