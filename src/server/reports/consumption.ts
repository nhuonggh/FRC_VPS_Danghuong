import { Prisma, type PrismaClient } from "@prisma/client";
import { timeRangeWhere, type TimeRange } from "@/lib/time-presets";
import type { ReportResult } from "./types";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ymd = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const pct = (num: Prisma.Decimal, den: Prisma.Decimal): number | null => (den.isZero() ? null : Number(num.div(den).times(100).toDecimalPlaces(1)));

/** Loại xuất KHO do bán theo định mức / lệnh SX / gia công trừ NVL — đây là “tiêu hao theo định mức” (sổ sách). */
const NORM_DOC_TYPES = ["SALE", "PRODUCTION_USE", "PROCESSING_USE"] as const;

interface Line { stocktake: string; at: Date; productId: number; code: string; name: string; unit: string; norm: Prisma.Decimal; shortage: Prisma.Decimal; actual: Prisma.Decimal }

/**
 * Tiêu hao thực tế của NVL (spec 6.5): giữa hai lần kiểm kho liên tiếp của cùng mã,
 *   thực tế = tiêu hao theo định mức (Σ xuất bán/SX/gia công trong khoảng) + (tồn sổ sách lúc chốt − tồn thực đếm).
 * Chênh lệch kiểm kho đã được phiếu kiểm kho ghi nhận vào kho khi chốt (STOCKTAKE_OUT/IN) — báo cáo này chỉ đối chiếu, không ghi thêm.
 */
async function lines(db: Db, range: TimeRange): Promise<Line[]> {
  const sts = await db.stocktake.findMany({
    where: { status: "DONE", at: timeRangeWhere(range) },
    orderBy: [{ at: "asc" }, { id: "asc" }],
    include: { lines: { include: { product: { select: { code: true, name: true, baseUnit: true, kind: true } } } } },
  });
  const out: Line[] = [];
  for (const st of sts) {
    for (const l of st.lines) {
      if (l.product.kind !== "NVL" || l.systemQty === null) continue;
      // Mốc trước: lần kiểm kho ĐÃ CHỐT gần nhất của cùng mã (trước phiếu này); chưa có ⇒ từ đầu kỳ.
      const prev = await db.stocktakeLine.findFirst({
        where: { productId: l.productId, stocktake: { status: "DONE", periodId: st.periodId, OR: [{ at: { lt: st.at } }, { at: st.at, id: { lt: st.id } }] } },
        orderBy: [{ stocktake: { at: "desc" } }, { stocktakeId: "desc" }], select: { stocktake: { select: { at: true } } },
      });
      const agg = await db.stockLedger.aggregate({
        where: { periodId: st.periodId, productId: l.productId, docType: { in: [...NORM_DOC_TYPES] }, at: { ...(prev ? { gt: prev.stocktake.at } : {}), lte: st.at } },
        _sum: { qtyOut: true },
      });
      const norm = D(agg._sum.qtyOut ?? 0), shortage = l.systemQty.minus(l.actualQty);
      out.push({ stocktake: st.code, at: st.at, productId: l.productId, code: l.product.code, name: l.product.name, unit: l.product.baseUnit, norm, shortage, actual: norm.plus(shortage) });
    }
  }
  return out;
}

const NOTE = "Thực tế = tiêu hao theo định mức + (tồn sổ sách − tồn thực đếm). Chênh lệch kiểm kho đã được phiếu kiểm kho ghi vào kho khi chốt; báo cáo chỉ đối chiếu.";

/** 52 — Tiêu hao thực tế: từng dòng kiểm kho của NVL. */
export async function actualConsumption(db: Db, range: TimeRange): Promise<ReportResult> {
  const rows = await lines(db, range);
  return {
    key: "actual-consumption", title: "Tiêu hao thực tế (từ kiểm kho)", total: rows.length, notes: [NOTE],
    summary: [{ label: "Phiếu kiểm kho", value: new Set(rows.map((r) => r.stocktake)).size }, { label: "Mã nguyên vật liệu", value: new Set(rows.map((r) => r.productId)).size }, { label: "Dòng thiếu khi kiểm", value: rows.filter((r) => r.shortage.gt(0)).length, tone: "warning" }, { label: "Dòng thừa khi kiểm", value: rows.filter((r) => r.shortage.lt(0)).length, tone: "info" }],
    columns: [{ key: "stocktake", label: "Phiếu kiểm", kind: "text" }, { key: "date", label: "Ngày", kind: "date" }, { key: "code", label: "Mã NVL", kind: "text" }, { key: "name", label: "Nguyên vật liệu", kind: "text", align: "left" }, { key: "unit", label: "ĐVT", kind: "text" }, { key: "norm", label: "Theo định mức", kind: "qty" }, { key: "shortage", label: "Thiếu (+) / thừa (−) khi kiểm", kind: "qty" }, { key: "actual", label: "Thực tế", kind: "qty" }],
    rows: rows.map((r) => ({ stocktake: r.stocktake, date: ymd(r.at), code: r.code, name: r.name, unit: r.unit, norm: r.norm.toString(), shortage: r.shortage.toString(), actual: r.actual.toString() })),
  };
}

/** 53 — Đối chiếu định mức ↔ thực tế: gộp theo NVL trong khoảng đã chọn; chênh = định mức − thực tế (âm = dùng vượt định mức, bôi đỏ). */
export async function consumptionCompare(db: Db, range: TimeRange, onlyOver: boolean): Promise<ReportResult> {
  const m = new Map<number, { code: string; name: string; unit: string; norm: Prisma.Decimal; actual: Prisma.Decimal; count: number }>();
  for (const l of await lines(db, range)) {
    const v = m.get(l.productId) ?? { code: l.code, name: l.name, unit: l.unit, norm: D(0), actual: D(0), count: 0 };
    v.norm = v.norm.plus(l.norm); v.actual = v.actual.plus(l.actual); v.count++; m.set(l.productId, v);
  }
  let rows = [...m.values()].map((v) => { const diff = v.norm.minus(v.actual); return { ...v, diff }; }).sort((a, b) => a.diff.comparedTo(b.diff));
  if (onlyOver) rows = rows.filter((r) => r.diff.lt(0));
  return {
    key: "consumption-compare", title: "Đối chiếu định mức và thực tế", total: rows.length, negativeKey: "diff", notes: [NOTE, "Chênh lệch = định mức − thực tế; số âm là nguyên vật liệu dùng vượt định mức (hao hụt)."],
    summary: [{ label: "Mã nguyên vật liệu", value: rows.length }, { label: "Mã vượt định mức", value: rows.filter((r) => r.diff.lt(0)).length, tone: "danger" }, { label: "Mã đúng định mức", value: rows.filter((r) => r.diff.isZero()).length, tone: "success" }, { label: "Mã dưới định mức", value: rows.filter((r) => r.diff.gt(0)).length, tone: "info" }],
    columns: [{ key: "code", label: "Mã NVL", kind: "text" }, { key: "name", label: "Nguyên vật liệu", kind: "text", align: "left" }, { key: "unit", label: "ĐVT", kind: "text" }, { key: "count", label: "Số lần kiểm", kind: "int" }, { key: "norm", label: "Theo định mức", kind: "qty" }, { key: "actual", label: "Thực tế", kind: "qty" }, { key: "diff", label: "Chênh lệch", kind: "qty" }, { key: "pct", label: "% chênh", kind: "pct" }],
    rows: rows.map((r) => ({ code: r.code, name: r.name, unit: r.unit, count: r.count, norm: r.norm.toString(), actual: r.actual.toString(), diff: r.diff.toString(), pct: pct(r.diff, r.norm) })),
  };
}

/** 72 — Báo cáo sản xuất: lệnh SX phụ kiện trong khoảng; giá thành chỉ hiện với cost.view. */
export async function productionReport(db: Db, range: TimeRange, showCost: boolean): Promise<ReportResult> {
  const orders = await db.productionOrder.findMany({
    where: { isCancelled: false, at: timeRangeWhere(range) }, orderBy: [{ at: "desc" }, { id: "desc" }],
    include: { product: { select: { code: true, name: true, baseUnit: true } }, _count: { select: { materials: true } } },
  });
  const layers = showCost && orders.length ? await db.costLayer.findMany({ where: { sourceDocType: "PRODUCTION_OUT", sourceDocId: { in: orders.map((o) => o.id) } }, select: { sourceDocId: true, unitCost: true } }) : [];
  const unitCost = new Map(layers.map((l) => [l.sourceDocId, l.unitCost]));
  let total = D(0);
  const rows = orders.map((o) => {
    const uc = unitCost.get(o.id), tot = uc ? uc.times(o.qty).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP) : null;
    if (tot) total = total.plus(tot);
    return { code: o.code, date: ymd(o.at), product: `${o.product.code} — ${o.product.name}`, qty: o.qty.toString(), unit: o.product.baseUnit, materials: o._count.materials, unitCost: uc?.toString() ?? null, totalCost: tot?.toString() ?? null };
  });
  const cost = showCost ? [{ key: "unitCost", label: "Giá thành/đv", kind: "money" as const }, { key: "totalCost", label: "Tổng giá thành", kind: "money" as const }] : [];
  return {
    key: "production", title: "Báo cáo sản xuất", total: rows.length,
    summary: [{ label: "Lệnh sản xuất", value: orders.length }, { label: "Mã phụ kiện", value: new Set(orders.map((o) => o.productId)).size }, { label: "Dòng nguyên vật liệu", value: orders.reduce((sum, o) => sum + o._count.materials, 0) }, ...(showCost ? [{ label: "Tổng giá thành đã ghi nhận", value: total.toString(), money: true }] : [])],
    columns: [{ key: "code", label: "Lệnh SX", kind: "text" }, { key: "date", label: "Ngày", kind: "date" }, { key: "product", label: "Phụ kiện", kind: "text", align: "left" }, { key: "qty", label: "Số lượng", kind: "qty" }, { key: "unit", label: "ĐVT", kind: "text" }, { key: "materials", label: "Số NVL", kind: "int" }, ...cost],
    rows: showCost ? rows : rows.map(({ unitCost: _u, totalCost: _t, ...r }) => r),
    ...(showCost ? { totals: { code: "Tổng", totalCost: total.toString() } } : {}),
    notes: ["Chỉ tính lệnh còn hiệu lực (không gồm lệnh đã hủy)."],
  };
}
