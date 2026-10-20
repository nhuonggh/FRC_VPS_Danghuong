import { Prisma } from "@prisma/client";
import { formatDate, formatQty } from "@/lib/format";
import type { Actor } from "@/lib/permissions/scope";
import { byMonth, cell, MONTH_LABELS, num, pctDelta, sqlMonth, topSlices, yearBounds, yearOfRange, type Db, type DashRange } from "./common";
import type { Dashboard, Kpi, Widget } from "./types";

export async function loadProduction(db: Db, _actor: Actor, range: DashRange): Promise<Dashboard> {
  const year = yearOfRange(range), yb = yearBounds(year);
  const live = (from: Date, to: Date) => ({ isCancelled: false, at: { gte: from, lt: to } });

  const [cur, prev, cancelled, materials, stocktakes, adjustments, monthly, byProduct, topMaterials, recent, curQty, prevQty] = await Promise.all([
    db.productionOrder.aggregate({ where: live(range.start, range.end), _count: { _all: true }, _sum: { qty: true } }),
    db.productionOrder.aggregate({ where: live(range.prevStart, range.prevEnd), _count: { _all: true }, _sum: { qty: true } }),
    db.productionOrder.count({ where: { isCancelled: true, at: { gte: range.start, lt: range.end } } }),
    db.productionMaterial.findMany({ where: { order: live(range.start, range.end) }, distinct: ["materialProductId"], select: { materialProductId: true } }),
    db.stocktake.groupBy({ by: ["status"], where: { at: { gte: range.start, lt: range.end } }, _count: { _all: true } }),
    db.stockAdjustment.groupBy({ by: ["type"], where: { isCancelled: false, type: { in: ["LOSS", "WRITE_OFF"] }, at: { gte: range.start, lt: range.end } }, _count: { _all: true } }),
    db.$queryRaw<{ m: number; qty: Prisma.Decimal; n: number }[]>`
      SELECT ${sqlMonth(Prisma.sql`o."at"`)} AS m, COALESCE(SUM(p.qty), 0) AS qty, COUNT(DISTINCT o.id)::int AS n
      FROM production_orders o JOIN production_outputs p ON p."orderId" = o.id
      WHERE o."isCancelled" = false AND o."at" >= ${yb.start} AND o."at" < ${yb.end} GROUP BY 1`,
    db.productionOutput.groupBy({ by: ["productId"], where: { order: live(range.start, range.end) }, _sum: { qty: true }, orderBy: { _sum: { qty: "desc" } }, take: 6 }),
    db.$queryRaw<{ id: number; code: string; name: string; qty: Prisma.Decimal }[]>`
      SELECT pr.id, pr.code, pr.name, SUM(m.qty) AS qty
      FROM production_materials m JOIN production_orders o ON o.id = m."orderId" JOIN products pr ON pr.id = m."materialProductId"
      WHERE o."isCancelled" = false AND o."at" >= ${range.start} AND o."at" < ${range.end}
      GROUP BY pr.id, pr.code, pr.name ORDER BY qty DESC LIMIT 5`,
    db.productionOrder.findMany({
      where: { at: { gte: range.start, lt: range.end } }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 5,
      select: { id: true, code: true, at: true, qty: true, isCancelled: true, outputs: { orderBy: { id: "asc" }, select: { qty: true, product: { select: { code: true, name: true, baseUnit: true } } } }, product: { select: { code: true, name: true, baseUnit: true } } },
    }),
    db.productionOutput.aggregate({ where: { order: live(range.start, range.end) }, _sum: { qty: true } }),
    db.productionOutput.aggregate({ where: { order: live(range.prevStart, range.prevEnd) }, _sum: { qty: true } }),
  ]);

  const productNames = new Map((await db.product.findMany({ where: { id: { in: byProduct.map((p) => p.productId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const count = cur._count._all, qty = num(curQty._sum.qty);
  const stocktake = (s: string) => stocktakes.find((r) => r.status === s)?._count._all ?? 0;
  const adjust = (t: string) => adjustments.find((r) => r.type === t)?._count._all ?? 0;

  const kpis: Kpi[] = [
    { key: "orders", label: "Số lệnh sản xuất", value: count, format: "count", icon: "factory", tone: "accent", delta: pctDelta(count, prev._count._all), href: "/production/orders" },
    { key: "qty", label: "Tổng số lượng thành phẩm", value: qty, format: "qty", icon: "package", tone: "success", delta: pctDelta(qty, num(prevQty._sum.qty)), caption: "Cộng theo đơn vị gốc" },
    { key: "materials", label: "Loại NVL tiêu hao", value: materials.length, format: "count", icon: "hammer", tone: "warning", href: "/reports/actual-consumption" },
    { key: "stocktake", label: "Phiếu kiểm kho", value: stocktake("DONE") + stocktake("DRAFT"), format: "count", icon: "list-checks", tone: "info", href: "/inventory/stocktakes", caption: `${stocktake("DRAFT")} phiếu nháp` },
    { key: "cancelled", label: "Lệnh đã hủy", value: cancelled, format: "count", icon: "trash-2", tone: "danger", deltaInverted: true },
  ];

  const widgets: Widget[] = [
    {
      key: "monthly", kind: "bars", title: `Sản xuất theo tháng (${year})`, span: 8, labels: MONTH_LABELS, barFormat: "qty",
      bars: [{ name: "Số lượng thành phẩm", values: byMonth(monthly, (r) => num(r.qty)), tone: "accent", format: "qty" }],
      line: { name: "Số lệnh", values: byMonth(monthly, (r) => r.n), tone: "success", format: "count" },
    },
    {
      key: "by-product", kind: "donut", title: "Cơ cấu thành phẩm theo sản phẩm", span: 4, format: "qty", centerLabel: "Số lượng", centerValue: qty,
      slices: topSlices(byProduct.map((p) => ({ label: productNames.get(p.productId) ?? "—", value: num(p._sum.qty) })), 5),
    },
    {
      key: "recent", kind: "table", title: "Lệnh sản xuất gần đây", span: 8, moreHref: "/production/orders",
      columns: [{ label: "Mã lệnh" }, { label: "Ngày" }, { label: "Thành phẩm" }, { label: "Số lượng", align: "right" }, { label: "Trạng thái" }],
      rows: recent.map((r) => [
        cell(r.code, { href: `/production/orders/${r.id}` }), cell(formatDate(r.at)), cell(r.outputs.map(o => `${o.product.code} · ${o.product.name}`).join("; ")),
        cell(r.outputs.map(o => `${formatQty(o.qty)} ${o.product.baseUnit}`).join("; "), { align: "right" }), r.isCancelled ? cell("Đã hủy", { tone: "danger" }) : cell("Đã ghi sổ", { tone: "success" }),
      ]),
    },
    {
      key: "top-materials", kind: "rank", title: "Top NVL tiêu hao", span: 4, format: "qty", moreHref: "/reports/actual-consumption",
      items: topMaterials.map((m) => ({ label: m.name, sub: m.code, value: num(m.qty), href: `/inventory/products/${m.id}` })),
    },
    {
      key: "control", kind: "status", title: "Kiểm kho và hao hụt", span: 12,
      items: [
        { label: "Kiểm kho đã chốt", value: stocktake("DONE"), tone: "success", icon: "list-checks" },
        { label: "Kiểm kho nháp", value: stocktake("DRAFT"), tone: "warning", icon: "clipboard-list" },
        { label: "Phiếu hao hụt", value: adjust("LOSS"), tone: "info", icon: "scale" },
        { label: "Phiếu xuất hủy", value: adjust("WRITE_OFF"), tone: "danger", icon: "trash-2" },
      ],
    },
  ];
  return { kpis, widgets, notes: ["Gia công thuê và giá thành sản xuất chưa có số liệu nên chưa hiển thị."] };
}
