import { Prisma } from "@prisma/client";
import { formatCurrency, formatPercent, formatQty } from "@/lib/format";
import { can } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { onHandList } from "@/server/inventory-reports/on-hand";
import { getOpenPeriod } from "@/server/period/guard";
import { byMonth, cell, KIND_LABEL, MONTH_LABELS, num, share, sqlMonth, topSlices, yearBounds, yearOfRange, type Db, type DashRange } from "./common";
import type { Dashboard, Kpi, Widget } from "./types";

export async function loadInventory(db: Db, actor: Actor, range: DashRange): Promise<Dashboard> {
  const cost = can(actor.perms, "cost.view");
  const period = await getOpenPeriod(db);
  const year = yearOfRange(range), yb = yearBounds(year);

  const [{ rows, stats }, monthly, before] = await Promise.all([
    onHandList(db, actor, parseListParams({}), { unpaged: true }),
    db.$queryRaw<{ m: number; qin: Prisma.Decimal; qout: Prisma.Decimal }[]>`
      SELECT ${sqlMonth(Prisma.sql`"at"`)} AS m, COALESCE(SUM("qtyIn"), 0) AS qin, COALESCE(SUM("qtyOut"), 0) AS qout
      FROM stock_ledger WHERE "periodId" = ${period.id} AND "at" >= ${yb.start} AND "at" < ${yb.end} GROUP BY 1`,
    db.$queryRaw<{ net: Prisma.Decimal }[]>`
      SELECT COALESCE(SUM("qtyIn" - "qtyOut"), 0) AS net FROM stock_ledger WHERE "periodId" = ${period.id} AND "at" < ${yb.start}`,
  ]);

  const items = rows.map((r) => ({ ...r, qty: num(r.onHand), min: num(r.minStock), value: num(r.stockValue), shortageQty: num(r.shortage) }));
  const totalQty = items.reduce((s, r) => s + Math.max(r.qty, 0), 0);
  const totalValue = items.reduce((s, r) => s + r.value, 0);
  const below = items.filter((r) => r.min > 0 && r.qty < r.min);
  const ok = items.filter((r) => r.min > 0 && r.qty >= r.min).length;
  const noMin = items.filter((r) => r.min <= 0).length;

  const ins = byMonth(monthly, (r) => num(r.qin)), outs = byMonth(monthly, (r) => num(r.qout));
  let run = num(before[0]?.net);
  const closing = ins.map((v, i) => (run += v - outs[i]!));

  const kpis: Kpi[] = [
    { key: "products", label: "Tổng số mã hàng", value: stats.products, format: "count", icon: "package", tone: "accent", href: "/inventory/products", caption: `${stats.inStock} mã đang có tồn` },
    { key: "qty", label: "Tổng tồn hiện tại", value: totalQty, format: "qty", icon: "layers", tone: "success", caption: "Cộng theo đơn vị gốc", href: "/inventory/stock" },
  ];
  if (cost) kpis.push({ key: "value", label: "Giá trị tồn kho", value: totalValue, format: "currency", icon: "coins", tone: "warning" });
  kpis.push(
    { key: "below", label: "Mã hàng dưới định mức", value: stats.below, format: "count", icon: "sliders-horizontal", tone: "danger", href: "/inventory/min-stock", deltaInverted: true },
    { key: "pending", label: "Mã đang bán treo (âm kho)", value: stats.pending, format: "count", icon: "clipboard-list", tone: "info", href: "/inventory/pending-orders" },
  );

  const byKind = new Map<string, { n: number; qty: number; value: number }>();
  for (const r of items) {
    const k = byKind.get(r.kind) ?? { n: 0, qty: 0, value: 0 };
    k.n += 1; k.qty += Math.max(r.qty, 0); k.value += r.value;
    byKind.set(r.kind, k);
  }
  const kindEntries = [...byKind.entries()];

  const widgets: Widget[] = [
    {
      key: "flow", kind: "bars", title: `Biến động nhập – xuất – tồn theo tháng (${year})`, span: 8, labels: MONTH_LABELS, barFormat: "qty",
      bars: [{ name: "Nhập", values: ins, tone: "accent", format: "qty" }, { name: "Xuất", values: outs, tone: "warning", format: "qty" }],
      line: { name: "Tồn cuối", values: closing, tone: "success", format: "qty" },
    },
    {
      key: "by-kind", kind: "donut", title: cost ? "Giá trị tồn theo nhóm hàng" : "Tồn kho theo nhóm hàng", span: 4, format: cost ? "currency" : "qty",
      centerLabel: cost ? "Giá trị tồn" : "Tồn", centerValue: cost ? totalValue : totalQty,
      slices: topSlices(kindEntries.map(([k, v]) => ({ label: KIND_LABEL[k] ?? k, value: cost ? v.value : v.qty })), 5),
    },
    {
      key: "top", kind: "table", title: cost ? "Top 10 mặt hàng tồn kho theo giá trị" : "Top 10 mặt hàng tồn kho nhiều nhất", span: 8, moreHref: "/inventory/stock",
      columns: [{ label: "Mã hàng" }, { label: "Tên hàng" }, { label: "ĐVT" }, { label: "Tồn kho", align: "right" }, ...(cost ? [{ label: "Giá trị", align: "right" as const }] : [])],
      rows: items.filter((r) => r.qty > 0).sort((a, b) => (cost ? b.value - a.value : b.qty - a.qty)).slice(0, 10).map((r) => [
        cell(r.code, { href: `/inventory/products/${r.productId}` }), cell(r.name), cell(r.baseUnit), cell(formatQty(r.qty), { align: "right" }), ...(cost ? [cell(formatCurrency(r.value), { align: "right" })] : []),
      ]),
    },
    {
      key: "min-status", kind: "donut", title: "Tình trạng tồn theo định mức", span: 4, format: "count", centerLabel: "mã hàng", centerValue: items.length,
      slices: [{ label: "Đạt định mức", value: ok, tone: "success" as const }, { label: "Dưới định mức", value: below.length, tone: "danger" as const }, { label: "Chưa đặt định mức", value: noMin, tone: "neutral" as const }].filter((s) => s.value > 0),
    },
    {
      key: "alerts", kind: "table", title: `Cảnh báo tồn dưới định mức (${below.length})`, span: 7, moreHref: "/inventory/min-stock",
      columns: [{ label: "Mã hàng" }, { label: "Tên hàng" }, { label: "Tồn hiện tại", align: "right" }, { label: "Định mức", align: "right" }, { label: "Thiếu", align: "right" }],
      rows: [...below].sort((a, b) => b.shortageQty - a.shortageQty).slice(0, 5).map((r) => [
        cell(r.code, { href: `/inventory/products/${r.productId}` }), cell(r.name), cell(formatQty(r.qty), { align: "right" }), cell(formatQty(r.min), { align: "right" }), cell(formatQty(r.shortageQty), { align: "right", tone: "danger" }),
      ]),
    },
    {
      key: "kinds", kind: "table", title: "Tồn kho theo nhóm hàng", span: 5,
      columns: [{ label: "Nhóm hàng" }, { label: "Số mã", align: "right" }, { label: "Tổng tồn", align: "right" }, ...(cost ? [{ label: "Giá trị", align: "right" as const }, { label: "Tỷ trọng", align: "right" as const }] : [])],
      rows: kindEntries.sort((a, b) => b[1].value - a[1].value || b[1].qty - a[1].qty).map(([k, v]) => [
        cell(KIND_LABEL[k] ?? k), cell(String(v.n), { align: "right" }), cell(formatQty(v.qty), { align: "right" }), ...(cost ? [cell(formatCurrency(v.value), { align: "right" }), cell(formatPercent(share(v.value, totalValue)), { align: "right" })] : []),
      ]),
    },
  ];
  return { kpis, widgets, notes: [`Số liệu tồn là hiện tại (kỳ đang mở), không đổi theo bộ lọc thời gian.${cost ? "" : " Bạn chưa có quyền xem giá vốn nên giá trị tồn được ẩn."}`] };
}
