import type { PrismaClient } from "@prisma/client";
import type { NavFunction, NavModule } from "@/config/app.config";
import { can } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { ICT_OFFSET_MS, toIct } from "@/lib/time";
import { parseListParams } from "@/lib/query-params";
import { onHandList } from "@/server/inventory-reports/on-hand";
import { getOpenPeriod } from "@/server/period/guard";
import type { HomeQuickLink, WidgetSpec, WidgetState } from "./types";

/** Mỗi widget có tối đa từng này ms; quá hạn thì báo lỗi cục bộ (không kéo cả trang). */
export const WIDGET_TIMEOUT_MS = 5000;

export function withTimeout<T>(work: Promise<T>, ms = WIDGET_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Widget quá thời gian chờ.")), ms); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Chạy MỘT widget độc lập: lỗi hoặc quá hạn chỉ làm widget đó hiện "Chưa tải được", không ném lỗi lên trang
 * và không bao giờ trả về số 0 giả.
 */
export async function loadWidget(db: PrismaClient, spec: WidgetSpec): Promise<WidgetState> {
  try {
    return { ok: true, value: await withTimeout(spec.run(db)) };
  } catch (error) {
    console.error(`[home] widget ${spec.key} lỗi:`, error);
    return { ok: false };
  }
}

/** [00:00 hôm nay ICT, 00:00 ngày mai ICT) dưới dạng thời điểm UTC. */
export function ictDayRange(now: Date): { start: Date; end: Date } {
  const t = toIct(now);
  const start = new Date(Date.UTC(t.y, t.m, t.d) - ICT_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** Số phiếu nhập còn hiệu lực trong ngày hôm nay (ICT) thuộc kỳ đang mở. */
export async function todayPurchaseCount(db: PrismaClient, now: Date): Promise<number> {
  const [period, { start, end }] = [await getOpenPeriod(db), ictDayRange(now)];
  return db.purchase.count({ where: { periodId: period.id, isCancelled: false, at: { gte: start, lt: end } } });
}

/** Số mã hàng có định mức tồn > 0 mà tồn hiện tại thấp hơn định mức. Không lộ giá. */
export async function lowStockCount(db: PrismaClient, actor: Actor): Promise<number> {
  const { stats } = await onHandList(db, actor, parseListParams({}), { belowMinOnly: true, unpaged: true });
  return stats.below;
}

/** Tổng giá trị tồn (giá vốn FIFO) của kỳ đang mở. Chỉ gọi khi actor có `cost.view`. */
export async function stockValueTotal(db: PrismaClient): Promise<string> {
  const period = await getOpenPeriod(db);
  const [row] = await db.$queryRaw<{ v: { toString(): string } }[]>`
    SELECT COALESCE(SUM("qtyRemaining" * "unitCost"), 0) AS v FROM cost_layers WHERE "periodId" = ${period.id}`;
  return row!.v.toString();
}

const flattenNav = (nav: readonly NavModule[]): NavFunction[] => nav.flatMap((m) => m.categories.flatMap((c) => c.functions));

/** Chức năng hay dùng, theo thứ tự hiển thị. Chỉ hiện khi CÒN trong menu đã lọc quyền (không planned, đủ quyền). */
const QUICK_KEYS = ["purchase-new", "purchase-list", "stock-onhand", "stock-min", "product-list", "bom-list", "company"] as const;

export function quickLinks(nav: readonly NavModule[]): HomeQuickLink[] {
  const byKey = new Map(flattenNav(nav).map((f) => [f.key, f]));
  return QUICK_KEYS.flatMap((k) => {
    const f = byKey.get(k);
    return f ? [{ key: f.key, label: f.label, href: f.path, icon: f.icon }] : [];
  });
}

/**
 * Widget số liệu cho actor: quyền kiểm ở SERVER trước khi có query nào chạy, và chỉ khi màn đích đã mở
 * (nằm trong `nav` đã lọc — không planned). Thiếu quyền/màn chưa giao → widget không tồn tại, không có số 0 giả.
 */
export function homeWidgets(nav: readonly NavModule[], actor: Actor, now: Date): WidgetSpec[] {
  const byKey = new Map(flattenNav(nav).map((f) => [f.key, f]));
  const specs: WidgetSpec[] = [];
  const add = (navKey: string, spec: Omit<WidgetSpec, "href">) => {
    const f = byKey.get(navKey);
    if (f) specs.push({ ...spec, href: f.path });
  };
  if (can(actor.perms, "purchase.view")) {
    add("purchase-list", { key: "purchase-today", label: "Phiếu nhập hôm nay", format: "count", run: (db) => todayPurchaseCount(db, now) });
  }
  if (can(actor.perms, "stock.view")) {
    add("stock-min", { key: "low-stock", label: "Mã hàng dưới định mức tồn", format: "count", tone: "warning", run: (db) => lowStockCount(db, actor) });
    if (can(actor.perms, "cost.view")) {
      add("stock-onhand", { key: "stock-value", label: "Giá trị tồn kho", format: "currency", run: (db) => stockValueTotal(db) });
    }
  }
  return specs;
}
