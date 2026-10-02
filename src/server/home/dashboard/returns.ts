import { Prisma } from "@prisma/client";
import { formatCurrency, formatDate } from "@/lib/format";
import { can } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { byMonth, cell, KIND_LABEL, MONTH_LABELS, num, pctDelta, sqlMonth, sqlPartnerScope, topSlices, yearBounds, yearOfRange, type Db, type DashRange } from "./common";
import type { Dashboard, Kpi, Widget } from "./types";

const RETURN_KIND: Record<string, string> = { BY_ORDER: "Trả theo đơn", BY_PRODUCT: "Trả theo sản phẩm", SUPPLIER: "Trả nhà cung cấp" };

export async function loadReturns(db: Db, actor: Actor, range: DashRange): Promise<Dashboard> {
  const money = can(actor.perms, "sale_price.view");
  const scope = { partner: partnerScopeWhere(actor) };
  const live = (from: Date, to: Date) => ({ ...scope, isCancelled: false, at: { gte: from, lt: to } });
  const year = yearOfRange(range), yb = yearBounds(year);

  const [cur, prev, items, prevItems, supplierCount, cancelled, monthly, byKind, byProductKind, topCustomers, topProducts, recent] = await Promise.all([
    db.goodsReturn.aggregate({ where: live(range.start, range.end), _count: { _all: true }, _sum: { totalAmount: true } }),
    db.goodsReturn.aggregate({ where: live(range.prevStart, range.prevEnd), _count: { _all: true }, _sum: { totalAmount: true } }),
    db.goodsReturnLine.findMany({ where: { goodsReturn: live(range.start, range.end) }, distinct: ["productId"], select: { productId: true } }),
    db.goodsReturnLine.findMany({ where: { goodsReturn: live(range.prevStart, range.prevEnd) }, distinct: ["productId"], select: { productId: true } }),
    db.goodsReturn.count({ where: { ...live(range.start, range.end), kind: "SUPPLIER" } }),
    db.goodsReturn.count({ where: { ...scope, isCancelled: true, at: { gte: range.start, lt: range.end } } }),
    db.$queryRaw<{ m: number; total: Prisma.Decimal; n: number }[]>`
      SELECT ${sqlMonth(Prisma.sql`r."at"`)} AS m, COALESCE(SUM(r."totalAmount"), 0) AS total, COUNT(*)::int AS n
      FROM goods_returns r JOIN partners p ON p.id = r."partnerId"
      WHERE r."isCancelled" = false AND r."at" >= ${yb.start} AND r."at" < ${yb.end} ${sqlPartnerScope(actor)} GROUP BY 1`,
    db.goodsReturn.groupBy({ by: ["kind"], where: live(range.start, range.end), _sum: { totalAmount: true }, _count: { _all: true } }),
    db.$queryRaw<{ kind: string; amount: Prisma.Decimal }[]>`
      SELECT pr.kind::text AS kind, COALESCE(SUM(l.amount), 0) AS amount
      FROM goods_return_lines l JOIN goods_returns r ON r.id = l."returnId" JOIN products pr ON pr.id = l."productId" JOIN partners p ON p.id = r."partnerId"
      WHERE r."isCancelled" = false AND r."at" >= ${range.start} AND r."at" < ${range.end} ${sqlPartnerScope(actor)} GROUP BY 1`,
    db.goodsReturn.groupBy({ by: ["partnerId"], where: { ...live(range.start, range.end), kind: { not: "SUPPLIER" } }, _sum: { totalAmount: true }, orderBy: { _sum: { totalAmount: "desc" } }, take: 5 }),
    db.$queryRaw<{ id: number; code: string; name: string; qty: Prisma.Decimal; amount: Prisma.Decimal }[]>`
      SELECT pr.id, pr.code, pr.name, COALESCE(SUM(l."qtyBase"), 0) AS qty, COALESCE(SUM(l.amount), 0) AS amount
      FROM goods_return_lines l JOIN goods_returns r ON r.id = l."returnId" JOIN products pr ON pr.id = l."productId" JOIN partners p ON p.id = r."partnerId"
      WHERE r."isCancelled" = false AND r."at" >= ${range.start} AND r."at" < ${range.end} ${sqlPartnerScope(actor)}
      GROUP BY pr.id, pr.code, pr.name ORDER BY ${money ? Prisma.sql`amount` : Prisma.sql`qty`} DESC LIMIT 5`,
    db.goodsReturn.findMany({
      where: { ...scope, at: { gte: range.start, lt: range.end } }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 5,
      select: { id: true, code: true, kind: true, at: true, isCancelled: true, totalAmount: true, partner: { select: { name: true } } },
    }),
  ]);

  const customerNames = new Map((await db.partner.findMany({ where: { id: { in: topCustomers.map((c) => c.partnerId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const total = num(cur._sum.totalAmount), count = cur._count._all;

  const kpis: Kpi[] = [{ key: "count", label: "Số phiếu trả hàng", value: count, format: "count", icon: "undo-2", tone: "accent", delta: pctDelta(count, prev._count._all), deltaInverted: true, href: "/returns/by-order" }];
  if (money) kpis.push({ key: "value", label: "Giá trị hàng trả", value: total, format: "currency", icon: "banknote", tone: "danger", delta: pctDelta(total, num(prev._sum.totalAmount)), deltaInverted: true });
  kpis.push(
    { key: "items", label: "Số mặt hàng bị trả", value: items.length, format: "count", icon: "package", tone: "warning", delta: pctDelta(items.length, prevItems.length), deltaInverted: true },
    { key: "supplier", label: "Phiếu trả nhà cung cấp", value: supplierCount, format: "count", icon: "building-2", tone: "info", href: "/returns/to-supplier" },
    { key: "cancelled", label: "Phiếu đã hủy", value: cancelled, format: "count", icon: "trash-2", tone: "neutral" },
  );

  const widgets: Widget[] = [{
    key: "monthly", kind: "bars", title: `Hàng trả theo tháng (${year})`, span: money ? 8 : 12, labels: MONTH_LABELS, barFormat: money ? "currency" : "count",
    bars: money ? [{ name: "Giá trị trả", values: byMonth(monthly, (r) => num(r.total)), tone: "danger", format: "currency" }] : [{ name: "Số phiếu trả", values: byMonth(monthly, (r) => r.n), tone: "info", format: "count" }],
    ...(money ? { line: { name: "Số phiếu trả", values: byMonth(monthly, (r) => r.n), tone: "info" as const, format: "count" as const } } : {}),
  }];
  widgets.push({
    key: "by-kind", kind: "donut", title: "Cơ cấu theo hình thức trả", span: 4, format: money ? "currency" : "count", centerLabel: money ? "Giá trị trả" : "phiếu", centerValue: money ? total : count,
    slices: byKind.map((r) => ({ label: RETURN_KIND[r.kind] ?? r.kind, value: money ? num(r._sum.totalAmount) : r._count._all })).filter((s) => s.value > 0),
  });
  if (money) {
    widgets.push({
      key: "by-product-kind", kind: "donut", title: "Giá trị trả theo nhóm hàng", span: 4, format: "currency", centerLabel: "Giá trị trả", centerValue: total,
      slices: topSlices(byProductKind.map((r) => ({ label: KIND_LABEL[r.kind] ?? r.kind, value: num(r.amount) })), 5),
    });
  }
  widgets.push({
    key: "recent", kind: "table", title: "Phiếu trả gần đây", span: money ? 8 : 12, moreHref: "/returns/by-order",
    columns: [{ label: "Mã phiếu" }, { label: "Ngày trả" }, { label: "Đối tác" }, { label: "Hình thức" }, ...(money ? [{ label: "Giá trị", align: "right" as const }] : []), { label: "Trạng thái" }],
    rows: recent.map((r) => [
      cell(r.code, { href: `/returns/${r.id}` }), cell(formatDate(r.at)), cell(r.partner.name), cell(RETURN_KIND[r.kind] ?? r.kind),
      ...(money ? [cell(formatCurrency(num(r.totalAmount)), { align: "right" })] : []), r.isCancelled ? cell("Đã hủy", { tone: "danger" }) : cell("Đã ghi sổ", { tone: "success" }),
    ]),
  });
  if (money) {
    widgets.push({
      key: "top-customers", kind: "rank", title: "Top khách trả nhiều nhất", span: 6, format: "currency",
      items: topCustomers.map((c) => ({ label: customerNames.get(c.partnerId) ?? "—", value: num(c._sum.totalAmount), href: `/sales/customers/${c.partnerId}` })),
    });
  }
  widgets.push({
    key: "top-products", kind: "rank", title: money ? "Top sản phẩm bị trả (theo giá trị)" : "Top sản phẩm bị trả (theo số lượng)", span: money ? 6 : 12, format: money ? "currency" : "qty",
    items: topProducts.map((p) => ({ label: p.name, sub: p.code, value: money ? num(p.amount) : num(p.qty), href: `/inventory/products/${p.id}` })),
  });
  return { kpis, widgets, notes: money ? undefined : ["Bạn chưa có quyền xem giá bán nên các số liệu tiền được ẩn."] };
}
