import { Prisma, type PrismaClient, type TripResultKind, type TripStatus } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { resolveTimeRange, timeRangeWhere } from "@/lib/time-presets";
import { orderPaid } from "@/server/deposits/status";
import { DomainError } from "@/server/http/errors";
import { lineAmountOf } from "@/server/sales/queries";
import { RESULT_LABEL, TRIP_STATUS_LABEL } from "./schemas";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const TRIP_FILTER_KEYS = ["status", "vehicle"] as const;
export const UNDELIVERED_FILTER_KEYS = ["result", "state"] as const;

const canSee = (actor: Actor) => { if (!actor.perms.has("trip.manage") && !actor.perms.has("trip.settle") && !actor.perms.has("trip.confirm_cash")) assertCan(actor.perms, "trip.manage"); };
const fullName = async (db: Db, ids: number[]) => new Map((await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
const ymd = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

export interface TripRowDTO {
  id: number; code: string; date: string; status: TripStatus; statusLabel: string; routeName: string | null; vehiclePlate: string; driverName: string; assistantName: string | null;
  stops: number; done: number; expected: string; collected: string;
}
export interface TripStatsDTO { active: number; returned: number; settled: number; confirmed: number }

/** Danh sách chuyến (39). Lọc: trạng thái, xe, từ khoá (mã chuyến / lái xe / biển số), thời gian theo NGÀY CHUYẾN. */
export async function listTrips(db: Db, actor: Actor, params: ListParams, opts: { statuses?: TripStatus[] } = {}): Promise<{ rows: TripRowDTO[]; total: number; stats: TripStatsDTO }> {
  canSee(actor);
  const terms = (params.q ?? "").trim().split(/\s+/).filter(Boolean); // tên lái xe có dấu: tìm theo chữ người dùng gõ
  const range = params.timePreset ? resolveTimeRange(params.timePreset, new Date(), { start: params.timeStart, end: params.timeEnd }) : null;
  const statuses = (opts.statuses ?? (params.filters.status ?? [])) as TripStatus[];
  const vehicles = (params.filters.vehicle ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const where: Prisma.TripWhereInput = {
    ...(statuses.length ? { status: { in: statuses } } : {}), ...(vehicles.length ? { vehicleId: { in: vehicles } } : {}), ...(range ? { tripDate: timeRangeWhere(range) } : {}),
    AND: terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { vehicle: { plate: { contains: escapeLike(t.toUpperCase()) } } }, { driver: { name: { contains: escapeLike(t), mode: "insensitive" as const } } }] })),
  };
  const [list, total, group] = await Promise.all([
    db.trip.findMany({ where, orderBy: [{ tripDate: "desc" }, { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize, include: { route: { select: { name: true } }, vehicle: { select: { plate: true } }, driver: { select: { name: true } }, assistant: { select: { name: true } }, stops: { select: { result: true, dueAmount: true, cashAmount: true, transferAmount: true } } } }),
    db.trip.count({ where }),
    db.trip.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const c = (s: TripStatus[]) => group.filter((g) => s.includes(g.status)).reduce((a, g) => a + g._count._all, 0);
  return {
    total,
    stats: { active: c(["PLANNED", "ON_ROAD"]), returned: c(["RETURNED"]), settled: c(["SETTLED"]), confirmed: c(["CONFIRMED"]) },
    rows: list.map((t) => ({
      id: t.id, code: t.code, date: ymd(t.tripDate), status: t.status, statusLabel: TRIP_STATUS_LABEL[t.status], routeName: t.route?.name ?? null, vehiclePlate: t.vehicle.plate, driverName: t.driver.name, assistantName: t.assistant?.name ?? null,
      stops: t.stops.length, done: t.stops.filter((s) => s.result !== null).length,
      expected: t.stops.reduce((s, x) => s.plus(x.dueAmount ?? 0), D(0)).toString(), collected: t.stops.reduce((s, x) => s.plus(x.cashAmount).plus(x.transferAmount), D(0)).toString(),
    })),
  };
}

export interface StopLineDTO { orderLineId: number; productCode: string; productName: string; unit: string; qty: string; delivered: string; remaining: string }
export interface StopDTO {
  id: number; seq: number; orderId: number; orderCode: string; orderTotal: string; partnerId: number; partnerName: string; phone: string | null; address: string | null; allowCredit: boolean; debtLimit: string;
  result: TripResultKind | null; resultLabel: string | null; due: string | null; cash: string; transfer: string; debt: string; promiseDate: string | null; resultNote: string | null; resultAt: Date | null;
  /** Gợi ý phải thu nếu giao hết phần còn lại = giá trị đơn − tiền đã thu (chưa tính điểm này). */
  suggestedDue: string; lines: StopLineDTO[]; deliveryNoteId: number | null; handledNote: string | null; canCancelResult: boolean;
}
export interface TripDetailDTO {
  id: number; code: string; date: string; status: TripStatus; statusLabel: string; note: string | null; routeName: string | null; vehiclePlate: string; driverName: string; assistantName: string | null;
  departedAt: Date | null; returnedAt: Date | null; createdByName: string | null;
  totals: { expected: string; cash: string; transfer: string; debt: string; diff: string };
  settled: { at: Date; byName: string | null; diffReason: string | null } | null; confirmed: { at: Date; byName: string | null; cashAccountName: string | null; transferAccountName: string | null } | null; cancelReason: string | null;
  stops: StopDTO[]; receipts: { id: number; code: string; amount: string; accountName: string }[];
}

export async function getTrip(db: Db, actor: Actor, id: number): Promise<TripDetailDTO> {
  canSee(actor);
  const t = await db.trip.findUnique({
    where: { id },
    include: {
      route: { select: { name: true } }, vehicle: { select: { plate: true } }, driver: { select: { name: true } }, assistant: { select: { name: true } },
      stops: { orderBy: { seq: "asc" }, include: { order: { include: { partner: { select: { id: true, name: true, phone: true, address: true, allowCredit: true, debtLimit: true } }, lines: { orderBy: { id: "asc" }, include: { product: { select: { code: true, name: true } }, deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } } } } } } } },
    },
  });
  if (!t) throw new DomainError("Không tìm thấy chuyến giao.", 404);
  const receipts = await db.receipt.findMany({ where: { tripId: id }, orderBy: { id: "asc" }, select: { id: true, code: true, amount: true, cashAccount: { select: { name: true } } } });
  const accIds = [t.cashAccountId, t.transferAccountId].filter((x): x is number => x !== null);
  const [accs, names] = await Promise.all([db.cashAccount.findMany({ where: { id: { in: accIds } }, select: { id: true, name: true } }), fullName(db, [t.createdBy, ...(t.settledBy ? [t.settledBy] : []), ...(t.confirmedBy ? [t.confirmedBy] : [])])]);
  const accName = new Map(accs.map((a) => [a.id, a.name]));
  const stops: StopDTO[] = [];
  for (const s of t.stops) {
    const o = s.order;
    const paid = await orderPaid(db, o.id, s.id);
    const total = o.lines.reduce((a, l) => a.plus(lineAmountOf(l)), D(0)).plus(o.shippingFee);
    const suggested = total.minus(paid).gt(0) ? total.minus(paid) : D(0);
    stops.push({
      id: s.id, seq: s.seq, orderId: o.id, orderCode: o.code, orderTotal: total.toString(), partnerId: o.partner.id, partnerName: o.partner.name, phone: o.partner.phone, address: o.partner.address, allowCredit: o.partner.allowCredit, debtLimit: o.partner.debtLimit.toString(),
      result: s.result, resultLabel: s.result ? RESULT_LABEL[s.result] : null, due: s.dueAmount?.toString() ?? null, cash: s.cashAmount.toString(), transfer: s.transferAmount.toString(), debt: s.debtAmount.toString(), promiseDate: s.promiseDate ? ymd(s.promiseDate) : null, resultNote: s.resultNote, resultAt: s.resultAt,
      suggestedDue: suggested.toString(), deliveryNoteId: s.deliveryNoteId, handledNote: s.handledNote,
      canCancelResult: s.result !== null && (t.status === "PLANNED" || t.status === "ON_ROAD" || t.status === "RETURNED"),
      lines: o.lines.map((l) => { const done = l.deliveryLines.reduce((a, d) => a.plus(d.qty), D(0)); return { orderLineId: l.id, productCode: l.product.code, productName: l.product.name, unit: l.unit, qty: l.qty.toString(), delivered: done.toString(), remaining: l.qty.minus(done).toString() }; }),
    });
  }
  const sum = (f: (s: StopDTO) => string | null) => stops.reduce((a, s) => a.plus(f(s) ?? 0), D(0));
  const expected = sum((s) => s.due), cash = sum((s) => s.cash), transfer = sum((s) => s.transfer), debt = sum((s) => s.debt);
  return {
    id: t.id, code: t.code, date: ymd(t.tripDate), status: t.status, statusLabel: TRIP_STATUS_LABEL[t.status], note: t.note, routeName: t.route?.name ?? null, vehiclePlate: t.vehicle.plate, driverName: t.driver.name, assistantName: t.assistant?.name ?? null,
    departedAt: t.departedAt, returnedAt: t.returnedAt, createdByName: names.get(t.createdBy) ?? null,
    totals: { expected: expected.toString(), cash: cash.toString(), transfer: transfer.toString(), debt: debt.toString(), diff: expected.minus(cash).minus(transfer).minus(debt).toString() },
    settled: t.settledAt ? { at: t.settledAt, byName: t.settledBy ? (names.get(t.settledBy) ?? null) : null, diffReason: t.diffReason } : null,
    confirmed: t.confirmedAt ? { at: t.confirmedAt, byName: t.confirmedBy ? (names.get(t.confirmedBy) ?? null) : null, cashAccountName: t.cashAccountId ? (accName.get(t.cashAccountId) ?? null) : null, transferAccountName: t.transferAccountId ? (accName.get(t.transferAccountId) ?? null) : null } : null,
    cancelReason: t.cancelReason, stops, receipts: receipts.map((r) => ({ id: r.id, code: r.code, amount: r.amount.toString(), accountName: r.cashAccount.name })),
  };
}

// ── chọn đơn để xếp chuyến ─────────────────────────────────────────────────────────────────────────────────────────────
export interface TripOrderOptionDTO { id: number; code: string; partnerName: string; address: string | null; phone: string | null; orderDate: string; expectedDate: string | null; remainingQty: string; note: string | null }
export async function searchTripOrders(db: Db, actor: Actor, q: string): Promise<TripOrderOptionDTO[]> {
  assertCan(actor.perms, "trip.manage");
  const terms = normalizeSearch(q).split(" ").filter(Boolean);
  const rows = await db.saleOrder.findMany({
    where: {
      isCancelled: false, isDraft: false, tripStops: { none: { result: null, trip: { status: { in: ["PLANNED", "ON_ROAD"] } } } },
      AND: terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { partner: { searchText: { contains: escapeLike(t) } } }] })),
    },
    orderBy: [{ expectedDeliveryDate: "asc" }, { id: "asc" }], take: 200,
    select: { id: true, code: true, orderDate: true, expectedDeliveryDate: true, note: true, partner: { select: { name: true, address: true, phone: true } }, lines: { select: { qty: true, deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } } } } },
  });
  return rows.map((o) => ({ ...o, remaining: o.lines.reduce((s, l) => s.plus(l.qty).minus(l.deliveryLines.reduce((a, d) => a.plus(d.qty), D(0))), D(0)) })).filter((o) => o.remaining.gt(0)).slice(0, 40).map((o) => ({
    id: o.id, code: o.code, partnerName: o.partner.name, address: o.partner.address, phone: o.partner.phone, orderDate: ymd(o.orderDate), expectedDate: o.expectedDeliveryDate ? ymd(o.expectedDeliveryDate) : null, remainingQty: o.remaining.toString(), note: o.note,
  }));
}

export interface TripOptionsDTO { vehicles: { id: number; name: string }[]; drivers: { id: number; name: string }[]; assistants: { id: number; name: string }[]; routes: { id: number; name: string }[] }
export async function listTripOptions(db: Db): Promise<TripOptionsDTO> {
  const [vehicles, drivers, routes] = await Promise.all([
    db.vehicle.findMany({ where: { isActive: true }, orderBy: { plate: "asc" }, select: { id: true, plate: true } }),
    db.driver.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, isAssistant: true } }),
    db.route.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { vehicles: vehicles.map((v) => ({ id: v.id, name: v.plate })), drivers: drivers.filter((d) => !d.isAssistant).map((d) => ({ id: d.id, name: d.name })), assistants: drivers.filter((d) => d.isAssistant).map((d) => ({ id: d.id, name: d.name })), routes };
}

// ── hàng không giao được (42) ────────────────────────────────────────────────────────────────────────────────────────
export interface UndeliveredRowDTO { stopId: number; tripId: number; tripCode: string; orderId: number; orderCode: string; partnerName: string; phone: string | null; address: string | null; result: TripResultKind; resultLabel: string; note: string | null; remainingQty: string; at: Date | null; handledNote: string | null; handledAt: Date | null }
export async function listUndelivered(db: Db, actor: Actor, params: ListParams): Promise<{ rows: UndeliveredRowDTO[]; total: number }> {
  assertCan(actor.perms, "trip.manage");
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const results = (params.filters.result ?? []).filter((r) => r === "KHONG_GIAO" || r === "GIAO_MOT_PHAN") as TripResultKind[];
  const handled = params.filters.state?.[0] === "handled";
  const where: Prisma.TripOrderWhereInput = {
    result: { in: results.length ? results : ["KHONG_GIAO", "GIAO_MOT_PHAN"] }, handledAt: handled ? { not: null } : null, order: { isCancelled: false }, trip: { status: { not: "CANCELLED" } },
    AND: terms.map((t) => ({ OR: [{ order: { code: { contains: escapeLike(t.toUpperCase()) } } }, { order: { partner: { searchText: { contains: escapeLike(t) } } } }] })),
  };
  const all = await db.tripOrder.findMany({ where, orderBy: [{ resultAt: "desc" }, { id: "desc" }], include: { trip: { select: { code: true } }, order: { select: { code: true, partner: { select: { name: true, phone: true, address: true } }, lines: { select: { qty: true, deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } } } } } } } });
  const rows = all.map((s) => ({ s, remaining: s.order.lines.reduce((a, l) => a.plus(l.qty).minus(l.deliveryLines.reduce((x, d) => x.plus(d.qty), D(0))), D(0)) })).filter((x) => x.remaining.gt(0));
  return {
    total: rows.length,
    rows: rows.slice((params.page - 1) * params.pageSize, params.page * params.pageSize).map(({ s, remaining }) => ({
      stopId: s.id, tripId: s.tripId, tripCode: s.trip.code, orderId: s.orderId, orderCode: s.order.code, partnerName: s.order.partner.name, phone: s.order.partner.phone, address: s.order.partner.address,
      result: s.result!, resultLabel: RESULT_LABEL[s.result!], note: s.resultNote, remainingQty: remaining.toString(), at: s.resultAt, handledNote: s.handledNote, handledAt: s.handledAt,
    })),
  };
}
