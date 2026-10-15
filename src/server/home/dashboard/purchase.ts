import { Prisma } from "@prisma/client";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { can } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { byMonth, cell, KIND_LABEL, MONTH_LABELS, num, pctDelta, share, sqlMonth, topSlices, yearBounds, yearOfRange, type Db, type DashRange } from "./common";
import type { Dashboard, Kpi, Widget } from "./types";

export async function loadPurchase(db: Db, actor: Actor, range: DashRange): Promise<Dashboard> {
  const money = can(actor.perms, "purchase_price.view");
  const year = yearOfRange(range), yb = yearBounds(year);
  const live = (from: Date, to: Date) => ({ isCancelled: false, at: { gte: from, lt: to } });

  const [cur, prev, items, prevItems, suppliers, cancelled, monthly, byKind, bySupplier, recent] = await Promise.all([
    db.purchase.aggregate({ where: live(range.start, range.end), _count: { _all: true }, _sum: { purchaseTotal: true } }),
    db.purchase.aggregate({ where: live(range.prevStart, range.prevEnd), _count: { _all: true }, _sum: { purchaseTotal: true } }),
    db.purchaseLine.findMany({ where: { purchase: live(range.start, range.end) }, distinct: ["productId"], select: { productId: true } }),
    db.purchaseLine.findMany({ where: { purchase: live(range.prevStart, range.prevEnd) }, distinct: ["productId"], select: { productId: true } }),
    db.purchase.findMany({ where: live(range.start, range.end), distinct: ["partnerId"], select: { partnerId: true } }),
    db.purchase.count({ where: { isCancelled: true, at: { gte: range.start, lt: range.end } } }),
    db.$queryRaw<{ m: number; total: Prisma.Decimal; n: number }[]>`
      SELECT ${sqlMonth(Prisma.sql`"at"`)} AS m, COALESCE(SUM("purchaseTotal"), 0) AS total, COUNT(*)::int AS n
      FROM purchases WHERE "isCancelled" = false AND "at" >= ${yb.start} AND "at" < ${yb.end} GROUP BY 1`,
    db.$queryRaw<{ kind: string; qty: Prisma.Decimal; amount: Prisma.Decimal }[]>`
      SELECT pr.kind::text AS kind, COALESCE(SUM(l."qtyBase"), 0) AS qty, COALESCE(SUM(l."purchaseAmount"), 0) AS amount
      FROM purchase_lines l JOIN purchases h ON h.id = l."purchaseId" JOIN products pr ON pr.id = l."productId"
      WHERE h."isCancelled" = false AND h."at" >= ${range.start} AND h."at" < ${range.end} GROUP BY 1`,
    db.purchase.groupBy({ by: ["partnerId"], where: live(range.start, range.end), _sum: { purchaseTotal: true }, _count: { _all: true }, orderBy: { _sum: { purchaseTotal: "desc" } }, take: 6 }),
    db.purchase.findMany({
      where: { at: { gte: range.start, lt: range.end } }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 5,
      select: { id: true, code: true, at: true, isCancelled: true, purchaseTotal: true, partner: { select: { name: true } } },
    }),
  ]);

  const partnerNames = new Map((await db.partner.findMany({ where: { id: { in: bySupplier.map((s) => s.partnerId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const total = num(cur._sum.purchaseTotal), count = cur._count._all;
  const kindTotal = byKind.reduce((s, r) => s + num(r.amount), 0);

  const kpis: Kpi[] = [{ key: "count", label: "Tổng số phiếu nhập", value: count, format: "count", icon: "file-text", tone: "accent", delta: pctDelta(count, prev._count._all), href: "/purchase/orders" }];
  if (money) kpis.push({ key: "value", label: "Tổng giá trị nhập hàng", value: total, format: "currency", icon: "layers", tone: "success", delta: pctDelta(total, num(prev._sum.purchaseTotal)) });
  kpis.push(
    { key: "items", label: "Số mặt hàng nhập", value: items.length, format: "count", icon: "package", tone: "warning", delta: pctDelta(items.length, prevItems.length) },
    { key: "suppliers", label: "Nhà cung cấp", value: suppliers.length, format: "count", icon: "building-2", tone: "info", href: "/purchase/suppliers" },
    { key: "cancelled", label: "Phiếu đã hủy", value: cancelled, format: "count", icon: "trash-2", tone: "danger", deltaInverted: true },
  );

  const widgets: Widget[] = [{
    key: "monthly", kind: "bars", title: `Giá trị nhập hàng theo tháng (${year})`, span: money ? 6 : 12, labels: MONTH_LABELS, barFormat: money ? "currency" : "count",
    bars: money ? [{ name: "Giá trị nhập", values: byMonth(monthly, (r) => num(r.total)), tone: "accent", format: "currency" }] : [{ name: "Số phiếu nhập", values: byMonth(monthly, (r) => r.n), tone: "info", format: "count" }],
    ...(money ? { line: { name: "Số phiếu nhập", values: byMonth(monthly, (r) => r.n), tone: "success" as const, format: "count" as const } } : {}),
  }];
  if (money) {
    widgets.push({
      key: "by-kind", kind: "donut", title: "Cơ cấu giá trị nhập theo nhóm hàng", span: 3, format: "currency", centerLabel: "Giá trị nhập", centerValue: kindTotal,
      slices: topSlices(byKind.map((r) => ({ label: KIND_LABEL[r.kind] ?? r.kind, value: num(r.amount) })), 5),
    });
    widgets.push({
      key: "by-supplier", kind: "donut", title: "Cơ cấu giá trị nhập theo nhà cung cấp", span: 3, format: "currency", centerLabel: "Giá trị nhập", centerValue: total,
      slices: topSlices(bySupplier.map((s) => ({ label: partnerNames.get(s.partnerId) ?? "—", value: num(s._sum.purchaseTotal) })), 5),
    });
  }
  widgets.push({
    key: "recent", kind: "table", title: "Danh sách phiếu nhập gần đây", span: 7, moreHref: "/purchase/orders",
    columns: [{ label: "Mã phiếu" }, { label: "Ngày nhập" }, { label: "Nhà cung cấp" }, ...(money ? [{ label: "Tổng tiền", align: "right" as const }] : []), { label: "Trạng thái" }],
    rows: recent.map((r) => [cell(r.code, { href: `/purchase/orders/${r.id}` }), cell(formatDate(r.at)), cell(r.partner.name), ...(money ? [cell(formatCurrency(num(r.purchaseTotal)), { align: "right" })] : []), r.isCancelled ? cell("Đã hủy", { tone: "danger" }) : cell("Đã nhập", { tone: "success" })]),
  });
  if (money) {
    widgets.push({
      key: "top-suppliers", kind: "rank", title: "Top nhà cung cấp theo giá trị nhập", span: 5, format: "currency", moreHref: "/purchase/suppliers",
      items: bySupplier.slice(0, 5).map((s) => ({ label: partnerNames.get(s.partnerId) ?? "—", value: num(s._sum.purchaseTotal), href: `/purchase/suppliers/${s.partnerId}` })),
    });
  }
  widgets.push({
    key: "kinds", kind: "table", title: "Nhóm hàng nhập nhiều nhất", span: 7,
    columns: [{ label: "Nhóm hàng" }, { label: "Số lượng (ĐV gốc)", align: "right" }, ...(money ? [{ label: "Giá trị", align: "right" as const }, { label: "Tỷ lệ", align: "right" as const }] : [])],
    rows: [...byKind].sort((a, b) => num(b.amount) - num(a.amount)).map((r) => [
      cell(KIND_LABEL[r.kind] ?? r.kind), cell(new Intl.NumberFormat("vi-VN").format(num(r.qty)), { align: "right" }),
      ...(money ? [cell(formatCurrency(num(r.amount)), { align: "right" }), cell(formatPercent(share(num(r.amount), kindTotal)), { align: "right" })] : []),
    ]),
  });
  widgets.push({
    key: "status", kind: "status", title: "Tình trạng nhập hàng", span: 5,
    items: [
      { label: "Đã nhập", value: count, tone: "success", icon: "package-plus", caption: `${share(count, count + cancelled)}%` },
      { label: "Đã hủy", value: cancelled, tone: "danger", icon: "trash-2" },
    ],
  });
  return { kpis, widgets, notes: money ? undefined : ["Bạn chưa có quyền xem giá nhập nên các số liệu tiền được ẩn."] };
}
