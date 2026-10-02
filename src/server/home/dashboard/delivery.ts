import { Prisma } from "@prisma/client";
import { formatCurrency, formatDate } from "@/lib/format";
import { can } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { ictStartOfDay, toIct } from "@/lib/time";
import { byDay, cell, daysOf, num, pctDelta, share, sqlDay, topSlices, type Db, type DashRange } from "./common";
import type { Cell, Dashboard, Kpi, Widget } from "./types";

const DONE = ["RETURNED", "SETTLED", "CONFIRMED"] as const;
const STATUS_LABEL: Record<string, { text: string; tone: Cell["tone"] }> = {
  PLANNED: { text: "Chưa xuất phát", tone: "neutral" }, ON_ROAD: { text: "Đang giao", tone: "info" }, RETURNED: { text: "Đã về", tone: "success" },
  SETTLED: { text: "Đã đối soát", tone: "success" }, CONFIRMED: { text: "Đã xác nhận", tone: "success" }, CANCELLED: { text: "Đã hủy", tone: "danger" },
};
const RESULT_LABEL: Record<string, string> = { GIAO_DU: "Giao đủ", GIAO_MOT_PHAN: "Giao một phần", GHI_NO: "Ghi nợ", HEN_TRA: "Hẹn trả", KHONG_GIAO: "Không giao được" };

export async function loadDelivery(db: Db, actor: Actor, range: DashRange, now: Date): Promise<Dashboard> {
  const money = can(actor.perms, "sale_price.view");
  const t = toIct(now), todayStart = ictStartOfDay(t.y, t.m, t.d), todayEnd = ictStartOfDay(t.y, t.m, t.d + 1);
  const days = daysOf(range);
  const inRange = { tripDate: { gte: range.start, lt: range.end } };
  const notCancelled = { ...inRange, status: { not: "CANCELLED" as const } };
  const count = (where: Prisma.TripWhereInput) => db.trip.count({ where });

  const [total, prevTotal, done, prevDone, onRoad, late, failedStops, prevFailedStops, byStatus, byResult, daily, recent, drivers, failedList, today, timing, stopTotals] = await Promise.all([
    count(notCancelled),
    count({ tripDate: { gte: range.prevStart, lt: range.prevEnd }, status: { not: "CANCELLED" } }),
    count({ ...inRange, status: { in: [...DONE] } }),
    count({ tripDate: { gte: range.prevStart, lt: range.prevEnd }, status: { in: [...DONE] } }),
    count({ ...inRange, status: "ON_ROAD" }),
    count({ ...inRange, status: "PLANNED", tripDate: { gte: range.start, lt: new Date(Math.min(range.end.getTime(), todayStart.getTime())) } }),
    db.tripOrder.count({ where: { result: "KHONG_GIAO", trip: notCancelled } }),
    db.tripOrder.count({ where: { result: "KHONG_GIAO", trip: { tripDate: { gte: range.prevStart, lt: range.prevEnd }, status: { not: "CANCELLED" } } } }),
    db.trip.groupBy({ by: ["status"], where: inRange, _count: { _all: true } }),
    db.tripOrder.groupBy({ by: ["result"], where: { result: { not: null }, trip: notCancelled }, _count: { _all: true }, _sum: { dueAmount: true } }),
    days
      ? db.$queryRaw<{ d: string; total: number; done: number }[]>`
          SELECT ${sqlDay(Prisma.sql`"tripDate"`)} AS d, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('RETURNED','SETTLED','CONFIRMED'))::int AS done
          FROM trips WHERE status <> 'CANCELLED' AND "tripDate" >= ${range.start} AND "tripDate" < ${range.end} GROUP BY 1`
      : Promise.resolve(null),
    db.trip.findMany({
      where: notCancelled, orderBy: [{ tripDate: "desc" }, { id: "desc" }], take: 5,
      select: { id: true, code: true, tripDate: true, status: true, vehicle: { select: { plate: true } }, driver: { select: { name: true } }, _count: { select: { stops: true } } },
    }),
    db.trip.groupBy({ by: ["vehicleId", "driverId"], where: notCancelled, _count: { _all: true }, orderBy: { _count: { vehicleId: "desc" } }, take: 5 }),
    db.tripOrder.findMany({
      where: { result: "KHONG_GIAO", trip: notCancelled }, orderBy: { id: "desc" }, take: 3,
      select: { resultNote: true, dueAmount: true, resultAt: true, order: { select: { id: true, code: true, partner: { select: { name: true } } } } },
    }),
    db.trip.findMany({
      where: { tripDate: { gte: todayStart, lt: todayEnd }, status: { not: "CANCELLED" } }, orderBy: { id: "asc" }, take: 6,
      select: { id: true, code: true, status: true, departedAt: true, vehicle: { select: { plate: true } }, driver: { select: { name: true } }, _count: { select: { stops: true } } },
    }),
    db.$queryRaw<{ hours: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM ("returnedAt" - "departedAt")) / 3600)::float AS hours FROM trips
      WHERE status <> 'CANCELLED' AND "departedAt" IS NOT NULL AND "returnedAt" IS NOT NULL AND "tripDate" >= ${range.start} AND "tripDate" < ${range.end}`,
    db.tripOrder.count({ where: { trip: notCancelled } }),
  ]);

  const vehicleIds = drivers.map((d) => d.vehicleId), driverIds = drivers.map((d) => d.driverId);
  const [vehicles, driverRows] = await Promise.all([
    db.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, plate: true } }),
    db.driver.findMany({ where: { id: { in: driverIds } }, select: { id: true, name: true } }),
  ]);
  const plate = new Map(vehicles.map((v) => [v.id, v.plate])), driverName = new Map(driverRows.map((d) => [d.id, d.name]));

  const resultCount = (k: string) => byResult.find((r) => r.result === k)?._count._all ?? 0;
  const resultTotal = byResult.reduce((s, r) => s + r._count._all, 0);
  const statusCount = (k: string) => byStatus.find((r) => r.status === k)?._count._all ?? 0;
  const avgHours = timing[0]?.hours ?? null;

  const kpis: Kpi[] = [
    { key: "total", label: "Tổng số chuyến", value: total, format: "count", icon: "truck", tone: "accent", delta: pctDelta(total, prevTotal), href: "/delivery/trips" },
    { key: "done", label: "Đã giao thành công", value: done, format: "count", icon: "list-checks", tone: "success", delta: pctDelta(done, prevDone), caption: `Tỷ lệ ${share(done, total)}%` },
    { key: "on-road", label: "Đang giao", value: onRoad, format: "count", icon: "calendar-check", tone: "warning" },
    { key: "late", label: "Chưa xuất phát / trễ", value: late, format: "count", icon: "clipboard-list", tone: "danger", caption: "Chuyến quá ngày giao mà chưa đi" },
    { key: "failed", label: "Hàng không giao được", value: failedStops, format: "count", icon: "undo-2", tone: "info", delta: pctDelta(failedStops, prevFailedStops), deltaInverted: true, href: "/delivery/undelivered" },
  ];

  const widgets: Widget[] = [];
  if (days) {
    widgets.push({
      key: "daily", kind: "bars", title: "Số chuyến giao hàng theo ngày", span: 6, labels: days.map((d) => d.label), barFormat: "count",
      bars: [
        { name: "Tổng chuyến", values: byDay(days, daily ?? [], (r) => r.total), tone: "accent" },
        { name: "Đã giao", values: byDay(days, daily ?? [], (r) => r.done), tone: "success" },
        { name: "Chưa giao", values: byDay(days, daily ?? [], (r) => r.total - r.done), tone: "warning" },
      ],
    });
  }
  widgets.push({
    key: "by-status", kind: "donut", title: "Tình trạng giao hàng", span: days ? 3 : 6, format: "count", centerLabel: "chuyến", centerValue: byStatus.filter((r) => r.status !== "CANCELLED").reduce((s, r) => s + r._count._all, 0),
    slices: topSlices(byStatus.filter((r) => r.status !== "CANCELLED").map((r) => ({ label: STATUS_LABEL[r.status]?.text ?? r.status, value: r._count._all })), 5),
  });
  widgets.push({
    key: "by-result", kind: "donut", title: "Kết quả giao theo đơn", span: days ? 3 : 6, format: "count", centerLabel: "đơn", centerValue: resultTotal,
    slices: topSlices(byResult.map((r) => ({ label: RESULT_LABEL[r.result ?? ""] ?? String(r.result), value: r._count._all })), 5),
  });
  widgets.push({
    key: "recent", kind: "table", title: "Danh sách chuyến giao gần đây", span: 7, moreHref: "/delivery/trips",
    columns: [{ label: "Mã chuyến" }, { label: "Ngày giao" }, { label: "Xe / Tài xế" }, { label: "Số đơn", align: "right" }, { label: "Trạng thái" }],
    rows: recent.map((r) => [cell(r.code, { href: `/delivery/trips/${r.id}` }), cell(formatDate(r.tripDate)), cell(`${r.vehicle.plate} · ${r.driver.name}`), cell(String(r._count.stops), { align: "right" }), cell(STATUS_LABEL[r.status]!.text, { tone: STATUS_LABEL[r.status]!.tone })]),
  });
  widgets.push({
    key: "drivers", kind: "rank", title: "Top tài xế / xe theo số chuyến", span: 5, format: "count", moreHref: "/delivery/trips",
    items: drivers.map((d) => ({ label: driverName.get(d.driverId) ?? "—", sub: plate.get(d.vehicleId), value: d._count._all })),
  });
  widgets.push({
    key: "failed", kind: "table", title: "Hàng không giao được gần đây", span: 5, moreHref: "/delivery/undelivered",
    columns: [{ label: "Mã đơn" }, { label: "Khách hàng" }, { label: "Lý do" }, ...(money ? [{ label: "Giá trị", align: "right" as const }] : [])],
    rows: failedList.map((f) => [cell(f.order.code, { href: `/sales/orders/${f.order.id}` }), cell(f.order.partner.name), cell(f.resultNote ?? "—"), ...(money ? [cell(formatCurrency(num(f.dueAmount)), { align: "right" })] : [])]),
  });
  widgets.push({
    key: "today", kind: "table", title: "Lịch xe hôm nay", span: 7, moreHref: "/delivery/trips",
    columns: [{ label: "Giờ đi" }, { label: "Xe / Tài xế" }, { label: "Số đơn", align: "right" }, { label: "Trạng thái" }],
    rows: today.map((r) => {
      const dep = r.departedAt ? toIct(r.departedAt) : null;
      return [cell(dep ? `${String(dep.hh).padStart(2, "0")}:${String(dep.mm).padStart(2, "0")}` : "—"), cell(`${r.vehicle.plate} · ${r.driver.name}`, { href: `/delivery/trips/${r.id}` }), cell(String(r._count.stops), { align: "right" }), cell(STATUS_LABEL[r.status]!.text, { tone: STATUS_LABEL[r.status]!.tone })];
    }),
  });
  widgets.push({
    key: "performance", kind: "status", title: "Hiệu quả giao hàng", span: 12,
    items: [
      { label: "Thời gian chuyến TB", value: avgHours, tone: "accent", icon: "calendar-check", format: "hours", caption: avgHours === null ? "Chưa có chuyến đủ giờ đi/về" : undefined },
      { label: "Số đơn / chuyến", value: total > 0 ? Math.round((stopTotals / total) * 10) / 10 : 0, tone: "warning", icon: "clipboard-list", format: "qty" },
      { label: "Tỷ lệ giao đủ", value: share(resultCount("GIAO_DU"), resultTotal), tone: "success", icon: "list-checks", format: "percent", caption: "Trên số đơn đã có kết quả" },
      { label: "Tỷ lệ không giao được", value: share(resultCount("KHONG_GIAO"), resultTotal), tone: "danger", icon: "undo-2", format: "percent" },
      { label: "Chuyến đã hủy", value: statusCount("CANCELLED"), tone: "neutral", icon: "trash-2" },
    ],
  });
  return { kpis, widgets, notes: ["Chưa ghi nhận quãng đường và giờ giao theo hẹn nên các chỉ số này chưa hiển thị."] };
}
