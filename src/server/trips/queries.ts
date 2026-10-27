import { remainingToDeliver } from "./remaining";
import { Prisma, type PrismaClient, type TripResultKind, type TripStatus } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { resolveTimeRange } from "@/lib/time-presets";
import { orderPaid } from "@/server/deposits/status";
import { DomainError } from "@/server/http/errors";
import { goodsTotalOf } from "@/server/sales/queries";
import { RESULT_LABEL, TRIP_STATUS_LABEL } from "./schemas";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const TRIP_FILTER_KEYS = ["status", "vehicle", "customer", "route", "collection"] as const;
export const TRIP_RESULTS_FILTER_KEYS = [...TRIP_FILTER_KEYS, "resultState", "detail", "entry"] as const;
export const UNDELIVERED_FILTER_KEYS = ["result", "state"] as const;

const canSee = (actor: Actor) => { if (!actor.perms.has("trip.manage") && !actor.perms.has("trip.settle") && !actor.perms.has("trip.confirm_cash")) assertCan(actor.perms, "trip.manage"); };
const fullName = async (db: Db, ids: number[]) => new Map((await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
const ymd = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

export interface TripRowDTO {
  id: number; code: string; date: string; status: TripStatus; statusLabel: string; routeName: string | null; vehiclePlate: string; driverName: string; assistantName: string | null;
  stops: number; done: number; expected: string; collected: string; cash: string; transfer: string;
  collectionStatus: "paid" | "unpaid" | null;
}
export interface TripStatsDTO { active: number; returned: number; settled: number; confirmed: number; all: number; counts: Record<TripStatus, number> }
export interface TripResultsSummary {
  total: number; stops: number; completed: number; pending: number; expected: string; collected: string; outstanding: string;
  paidTrips: number; unpaidTrips: number; tabPaidTrips: number; tabUnpaidTrips: number; tabAllTrips: number; filteredExpected: string; filteredCollected: string; counts: Record<TripStatus, number>;
}

/** Server pagination and tab counts share the same customer/route/collection/date/search predicate. */
export async function listTrips(db: Db, actor: Actor, params: ListParams, opts: { statuses?: TripStatus[]; now?: Date; resultsSummary?: boolean } = {}): Promise<{ rows: TripRowDTO[]; total: number; stats: TripStatsDTO; resultsSummary?: TripResultsSummary }> {
  canSee(actor);
  const range = params.timePreset ? resolveTimeRange(params.timePreset, opts.now ?? new Date(), { start: params.timeStart, end: params.timeEnd }) : null;
  const statuses = [...new Set((opts.statuses ?? params.filters.status ?? []).filter((s): s is TripStatus => Object.prototype.hasOwnProperty.call(TRIP_STATUS_LABEL, s)))];
  const conditions: Prisma.Sql[] = [Prisma.sql`true`];
  if (range) conditions.push(Prisma.sql`t."tripDate" >= ${range.start} AND t."tripDate" < ${range.end}`);
  for (const key of ["vehicle", "route", "customer"] as const) {
    const values = params.filters[key] ?? [];
    if (!values.length) continue;
    const ids = values.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
    if (key === "route" && values.includes("none")) {
      conditions.push(ids.length ? Prisma.sql`(t."routeId" IS NULL OR t."routeId" IN (${Prisma.join(ids)}))` : Prisma.sql`t."routeId" IS NULL`);
      continue;
    }
    if (!ids.length) { conditions.push(Prisma.sql`false`); continue; }
    if (key === "vehicle") conditions.push(Prisma.sql`t."vehicleId" IN (${Prisma.join(ids)})`);
    else if (key === "route") conditions.push(Prisma.sql`t."routeId" IN (${Prisma.join(ids)})`);
    else conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM trip_orders s JOIN sale_orders o ON o.id = s."orderId" WHERE s."tripId" = t.id AND o."partnerId" IN (${Prisma.join(ids)}))`);
  }
  for (const term of (params.q ?? "").trim().split(/\s+/).filter(Boolean)) {
    const pattern = `%${escapeLike(term)}%`;
    conditions.push(Prisma.sql`(t.code ILIKE ${pattern} OR v.plate ILIKE ${pattern} OR dr.name ILIKE ${pattern})`);
  }
  // ASSUMPTION: paid means every stop has a result and no outstanding due after cash/transfer/discount.
  // Overpayments at one stop cannot offset unpaid amounts at another. Cancelled trips have no collection state.
  const unpaid = Prisma.sql`(NOT EXISTS (SELECT 1 FROM trip_orders s WHERE s."tripId" = t.id) OR EXISTS (
    SELECT 1 FROM trip_orders s WHERE s."tripId" = t.id AND (s.result IS NULL OR s."dueAmount" IS NULL
      OR s."dueAmount" - s."cashAmount" - s."transferAmount" - s."discountAmount" + s."overAmount" > 0)))`;
  const collection = Prisma.sql`CASE WHEN t.status = 'CANCELLED' THEN NULL WHEN ${unpaid} THEN 'unpaid' ELSE 'paid' END`;
  const summarySource = Prisma.sql`SELECT t.id, t.status, ${collection} AS collection FROM trips t JOIN vehicles v ON v.id = t."vehicleId" JOIN drivers dr ON dr.id = t."driverId" WHERE ${Prisma.join(conditions, " AND ")}`;
  const selectedCollection = (params.filters.collection ?? []).filter((s) => s === "paid" || s === "unpaid");
  if (selectedCollection.length) conditions.push(Prisma.sql`${collection} IN (${Prisma.join(selectedCollection)})`);
  if (opts.statuses?.length) conditions.push(Prisma.sql`t.status::text IN (${Prisma.join(opts.statuses)})`);
  const source = Prisma.sql`SELECT t.id, t.status, t."tripDate", ${collection} AS collection
    FROM trips t JOIN vehicles v ON v.id = t."vehicleId" JOIN drivers dr ON dr.id = t."driverId"
    WHERE ${Prisma.join(conditions, " AND ")}`;
  const [group, page] = await Promise.all([
    db.$queryRaw<{ status: TripStatus; count: bigint }[]>`SELECT status, COUNT(*) AS count FROM (${source}) matched GROUP BY status`,
    db.$queryRaw<{ id: number; collection: "paid" | "unpaid" | null }[]>`SELECT id, collection FROM (${source}) matched
      ${statuses.length ? Prisma.sql`WHERE status::text IN (${Prisma.join(statuses)})` : Prisma.empty}
      ORDER BY "tripDate" DESC, id DESC LIMIT ${params.pageSize} OFFSET ${(params.page - 1) * params.pageSize}`,
  ]);
  const counts = Object.fromEntries(Object.keys(TRIP_STATUS_LABEL).map((key) => [key, Number(group.find((g) => g.status === key)?.count ?? 0)])) as Record<TripStatus, number>;
  const c = (keys: TripStatus[]) => keys.reduce((sum, key) => sum + counts[key], 0);
  const list = page.length ? await db.trip.findMany({ where: { id: { in: page.map((r) => r.id) } }, orderBy: [{ tripDate: "desc" }, { id: "desc" }], include: { route: { select: { name: true } }, vehicle: { select: { plate: true } }, driver: { select: { name: true } }, assistant: { select: { name: true } }, stops: { select: { result: true, dueAmount: true, cashAmount: true, transferAmount: true } } } }) : [];
  const collectionById = new Map(page.map((r) => [r.id, r.collection]));
  let resultsSummary: TripResultsSummary | undefined;
  if (opts.resultsSummary) {
    const groups = await db.$queryRaw<{ status: TripStatus; collection: string | null; count: bigint; stops: bigint; completed: bigint; pending: bigint; expected: Prisma.Decimal; collected: Prisma.Decimal; outstanding: Prisma.Decimal }[]>`
      SELECT t.status, t.collection, COUNT(DISTINCT t.id) AS count,
        COUNT(s.id) FILTER (WHERE t.status <> 'CANCELLED') AS stops,
        COUNT(s.id) FILTER (WHERE t.status <> 'CANCELLED' AND s.result::text IN ('GIAO_DU','GHI_NO','HEN_TRA')) AS completed,
        COUNT(s.id) FILTER (WHERE t.status <> 'CANCELLED' AND s.result IS NULL) AS pending,
        COALESCE(SUM(s."dueAmount") FILTER (WHERE t.status <> 'CANCELLED'),0) AS expected,
        COALESCE(SUM(s."cashAmount" + s."transferAmount") FILTER (WHERE t.status <> 'CANCELLED'),0) AS collected,
        COALESCE(SUM(GREATEST(s."dueAmount" - s."cashAmount" - s."transferAmount" - s."discountAmount" + s."overAmount",0)) FILTER (WHERE t.status <> 'CANCELLED'),0) AS outstanding
      FROM (${summarySource}) t LEFT JOIN trip_orders s ON s."tripId" = t.id GROUP BY t.status, t.collection`;
    const sum = (key: "expected" | "collected" | "outstanding", filtered = false) => groups.filter((g) => !filtered || ((!statuses.length || statuses.includes(g.status)) && (!selectedCollection.length || selectedCollection.some((value) => value === g.collection)))).reduce((s, g) => s.plus(g[key]), D(0)).toString();
    resultsSummary = { total: groups.reduce((n, g) => n + Number(g.count), 0), stops: groups.reduce((n, g) => n + Number(g.stops), 0), completed: groups.reduce((n, g) => n + Number(g.completed), 0), pending: groups.reduce((n, g) => n + Number(g.pending), 0), expected: sum("expected"), collected: sum("collected"), outstanding: sum("outstanding"),
      paidTrips: groups.filter((g) => g.collection === "paid").reduce((n, g) => n + Number(g.count), 0), unpaidTrips: groups.filter((g) => g.collection === "unpaid").reduce((n, g) => n + Number(g.count), 0),
      tabPaidTrips: groups.filter((g) => g.collection === "paid" && (!statuses.length || statuses.includes(g.status))).reduce((n, g) => n + Number(g.count), 0), tabUnpaidTrips: groups.filter((g) => g.collection === "unpaid" && (!statuses.length || statuses.includes(g.status))).reduce((n, g) => n + Number(g.count), 0), tabAllTrips: groups.filter((g) => !statuses.length || statuses.includes(g.status)).reduce((n, g) => n + Number(g.count), 0),
      filteredExpected: sum("expected", true), filteredCollected: sum("collected", true), counts: Object.fromEntries(Object.keys(TRIP_STATUS_LABEL).map((key) => [key, groups.filter((g) => g.status === key).reduce((n, g) => n + Number(g.count), 0)])) as Record<TripStatus, number> };
  }
  return {
    total: c(statuses.length ? statuses : Object.keys(TRIP_STATUS_LABEL) as TripStatus[]),
    resultsSummary,
    stats: { active: c(["PLANNED", "ON_ROAD"]), returned: counts.RETURNED, settled: counts.SETTLED, confirmed: counts.CONFIRMED, all: c(Object.keys(TRIP_STATUS_LABEL) as TripStatus[]), counts },
    rows: list.map((t) => ({
      id: t.id, code: t.code, date: ymd(t.tripDate), status: t.status, statusLabel: TRIP_STATUS_LABEL[t.status], routeName: t.route?.name ?? null, vehiclePlate: t.vehicle.plate, driverName: t.driver.name, assistantName: t.assistant?.name ?? null,
      stops: t.stops.length, done: t.stops.filter((s) => s.result !== null).length,
      expected: t.stops.reduce((s, x) => s.plus(x.dueAmount ?? 0), D(0)).toString(), collected: t.stops.reduce((s, x) => s.plus(x.cashAmount).plus(x.transferAmount), D(0)).toString(),
      cash: t.stops.reduce((s, x) => s.plus(x.cashAmount), D(0)).toString(), transfer: t.stops.reduce((s, x) => s.plus(x.transferAmount), D(0)).toString(), collectionStatus: collectionById.get(t.id) ?? null,
    })),
  };
}

export async function listTripFilterOptions(db: Db, actor: Actor) {
  canSee(actor);
  const [customers, routes] = await Promise.all([
    db.partner.findMany({ where: { saleOrders: { some: { tripStops: { some: {} } } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.route.findMany({ where: { trips: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { customers, routes };
}
export interface StopLineDTO { orderLineId: number; productCode: string; productName: string; processingTypeName: string | null; unit: string; qty: string; delivered: string; remaining: string }
export interface StopDTO {
  id: number; seq: number; orderId: number; orderCode: string; orderTotal: string; partnerId: number; partnerName: string; phone: string | null; address: string | null; allowCredit: boolean; debtLimit: string;
  result: TripResultKind | null; resultLabel: string | null; due: string | null; cash: string; transfer: string; cashAccountId: number | null; transferAccountId: number | null; debt: string; discount: string; over: string; promiseDate: string | null; resultNote: string | null; resultAt: Date | null;
  /** Gợi ý phải thu nếu giao hết phần còn lại = giá trị đơn − tiền đã thu (chưa tính điểm này). */
  suggestedDue: string; lines: StopLineDTO[]; deliveryNoteId: number | null; handledNote: string | null; canCancelResult: boolean;
}
export interface TripDetailDTO {
  id: number; code: string; date: string; status: TripStatus; statusLabel: string; note: string | null; routeName: string | null; vehiclePlate: string; driverName: string; assistantName: string | null;
  departedAt: Date | null; returnedAt: Date | null; createdByName: string | null;
  totals: { expected: string; cash: string; transfer: string; debt: string; discount: string; over: string; diff: string; expense: string };
  /** Chi phí lái xe ứng từ tiền thu; sau khi thủ quỹ xác nhận có mã phiếu chi. */
  expenses: { id: number; expenseTypeName: string; cashAccountName: string; amount: string; note: string | null; paymentId: number | null; paymentCode: string | null }[];
  settled: { at: Date; byName: string | null; diffReason: string | null } | null; confirmed: { at: Date; byName: string | null; cashAccountName: string | null; transferAccountName: string | null } | null; cancelReason: string | null;
  stops: StopDTO[]; receipts: { id: number; code: string; amount: string; accountName: string }[];
}

export async function getTrip(db: Db, actor: Actor, id: number): Promise<TripDetailDTO> {
  canSee(actor);
  const t = await db.trip.findUnique({
    where: { id },
    include: {
      route: { select: { name: true } }, vehicle: { select: { plate: true } }, driver: { select: { name: true } }, assistant: { select: { name: true } },
      stops: { orderBy: { seq: "asc" }, include: { order: { include: { partner: { select: { id: true, name: true, phone: true, address: true, allowCredit: true, debtLimit: true } }, lines: { orderBy: { id: "asc" }, include: { product: { select: { code: true, name: true } }, processingType: { select: { name: true } }, returnLines: { where: { goodsReturn: { isCancelled: false, undelivered: true } }, select: { qty: true } }, deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true, deliveryNoteId: true } } } } } } } },
    },
  });
  if (!t) throw new DomainError("Không tìm thấy chuyến giao.", 404);
  const expenseRows = await db.tripExpense.findMany({ where: { tripId: id }, orderBy: { id: "asc" }, include: { expenseType: { select: { name: true } }, cashAccount: { select: { name: true } }, payment: { select: { code: true } } } });
  const receipts = await db.receipt.findMany({ where: { tripId: id }, orderBy: { id: "asc" }, select: { id: true, code: true, amount: true, cashAccount: { select: { name: true } } } });
  const accIds = [t.cashAccountId, t.transferAccountId].filter((x): x is number => x !== null);
  const [accs, names] = await Promise.all([db.cashAccount.findMany({ where: { id: { in: accIds } }, select: { id: true, name: true } }), fullName(db, [t.createdBy, ...(t.settledBy ? [t.settledBy] : []), ...(t.confirmedBy ? [t.confirmedBy] : [])])]);
  const accName = new Map(accs.map((a) => [a.id, a.name]));
  const stops: StopDTO[] = [];
  for (const s of t.stops) {
    const o = s.order;
    const paid = await orderPaid(db, o.id, s.id);
    const total = goodsTotalOf(o.lines, o).plus(o.shippingFee);
    const suggested = total.minus(paid).gt(0) ? total.minus(paid) : D(0);
    // Sửa kết quả đã nhập: server hoàn tác phiếu giao của chính điểm này trước ⇒ số còn giao phải cộng lại phần đó
    const own = (l: { deliveryLines: { qty: Prisma.Decimal; deliveryNoteId: number }[] }) => l.deliveryLines.filter((d) => s.deliveryNoteId !== null && d.deliveryNoteId === s.deliveryNoteId).reduce((a, d) => a.plus(d.qty), D(0));
    stops.push({
      id: s.id, seq: s.seq, orderId: o.id, orderCode: o.code, orderTotal: total.toString(), partnerId: o.partner.id, partnerName: o.partner.name, phone: o.partner.phone, address: o.partner.address, allowCredit: o.partner.allowCredit, debtLimit: o.partner.debtLimit.toString(),
      result: s.result, resultLabel: s.result ? RESULT_LABEL[s.result] : null, due: s.dueAmount?.toString() ?? null, cash: s.cashAmount.toString(), transfer: s.transferAmount.toString(), cashAccountId: s.cashAccountId, transferAccountId: s.transferAccountId, debt: s.debtAmount.toString(), discount: s.discountAmount.toString(), over: s.overAmount.toString(), promiseDate: s.promiseDate ? ymd(s.promiseDate) : null, resultNote: s.resultNote, resultAt: s.resultAt,
      suggestedDue: suggested.toString(), deliveryNoteId: s.deliveryNoteId, handledNote: s.handledNote,
      canCancelResult: s.result !== null && (t.status === "PLANNED" || t.status === "ON_ROAD" || t.status === "RETURNED"),
      lines: o.lines.map((l) => { const done = l.deliveryLines.reduce((a, d) => a.plus(d.qty), D(0)); return { orderLineId: l.id, productCode: l.product.code, productName: l.product.name, processingTypeName: l.processingType?.name ?? null, unit: l.unit, qty: l.qty.toString(), delivered: done.toString(), remaining: remainingToDeliver(l).plus(own(l)).toString() }; }),
    });
  }
  const sum = (f: (s: StopDTO) => string | null) => stops.reduce((a, s) => a.plus(f(s) ?? 0), D(0));
  const expected = sum((s) => s.due), cash = sum((s) => s.cash), transfer = sum((s) => s.transfer), debt = sum((s) => s.debt), discount = sum((s) => s.discount), over = sum((s) => s.over);
  return {
    id: t.id, code: t.code, date: ymd(t.tripDate), status: t.status, statusLabel: TRIP_STATUS_LABEL[t.status], note: t.note, routeName: t.route?.name ?? null, vehiclePlate: t.vehicle.plate, driverName: t.driver.name, assistantName: t.assistant?.name ?? null,
    departedAt: t.departedAt, returnedAt: t.returnedAt, createdByName: names.get(t.createdBy) ?? null,
    totals: { expected: expected.toString(), cash: cash.toString(), transfer: transfer.toString(), debt: debt.toString(), discount: discount.toString(), over: over.toString(), diff: expected.plus(over).minus(cash).minus(transfer).minus(debt).minus(discount).toString(), expense: expenseRows.reduce((a, e) => a.plus(e.amount), D(0)).toString() },
    expenses: expenseRows.map((e) => ({ id: e.id, expenseTypeName: e.expenseType.name, cashAccountName: e.cashAccount.name, amount: e.amount.toString(), note: e.note, paymentId: e.paymentId, paymentCode: e.payment?.code ?? null })),
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
    select: { id: true, code: true, orderDate: true, expectedDeliveryDate: true, note: true, partner: { select: { name: true, address: true, phone: true } }, lines: { select: { qty: true, returnLines: { where: { goodsReturn: { isCancelled: false, undelivered: true } }, select: { qty: true } }, deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } } } } },
  });
  return rows.map((o) => ({ ...o, remaining: o.lines.reduce((s, l) => s.plus(remainingToDeliver(l)), D(0)) })).filter((o) => o.remaining.gt(0)).slice(0, 40).map((o) => ({
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
export interface UndeliveredRowDTO { stopId: number; tripId: number; tripCode: string; orderId: number; orderCode: string; partnerName: string; phone: string | null; address: string | null; result: TripResultKind; resultLabel: string; note: string | null; remainingQty: string; at: Date | null; handledNote: string | null; handledAt: Date | null; returnedQty: string; activeTripId: number | null; activeTripCode: string | null }
export async function listUndelivered(db: Db, actor: Actor, params: ListParams) {
  assertCan(actor.perms, "trip.manage");
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const results = (params.filters.result ?? []).filter((r) => r === "KHONG_GIAO" || r === "GIAO_MOT_PHAN") as TripResultKind[];
  const states = params.filters.state?.length ? params.filters.state : ["pending"];
  const where: Prisma.TripOrderWhereInput = {
    result: { in: results.length ? results : ["KHONG_GIAO", "GIAO_MOT_PHAN"] }, order: { isCancelled: false }, trip: { status: { not: "CANCELLED" } },
    AND: terms.map((t) => ({ OR: [{ order: { code: { contains: escapeLike(t.toUpperCase()) } } }, { order: { partner: { searchText: { contains: escapeLike(t) } } } }] })),
  };
  const all = await db.tripOrder.findMany({ where, orderBy: [{ resultAt: "desc" }, { id: "desc" }], include: { trip: { select: { code: true } }, order: { select: { code: true, tripStops: { where: { result: null, trip: { status: { in: ["PLANNED", "ON_ROAD"] } } }, select: { tripId: true, trip: { select: { code: true } } }, take: 1 }, partner: { select: { name: true, phone: true, address: true } }, lines: { select: { qty: true, returnLines: { where: { goodsReturn: { isCancelled: false, undelivered: true } }, select: { qty: true } }, deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } } } } } } } });
  const rows = all.map((s) => ({ s, remaining: s.order.lines.reduce((a, l) => a.plus(remainingToDeliver(l)), D(0)), returned: s.order.lines.reduce((a, l) => a.plus(l.returnLines.reduce((x, d) => x.plus(d.qty), D(0))), D(0)) })).filter((x) => states.includes(x.remaining.lte(0) ? "completed" : x.s.handledAt ? "handled" : "pending"));
  return {
    total: rows.length,
    stats: { orders: new Set(rows.map(({ s }) => s.orderId)).size, failed: rows.filter(({ s }) => s.result === "KHONG_GIAO").length, partial: rows.filter(({ s }) => s.result === "GIAO_MOT_PHAN").length, trips: new Set(rows.map(({ s }) => s.tripId)).size },
    rows: rows.slice((params.page - 1) * params.pageSize, params.page * params.pageSize).map(({ s, remaining, returned }) => ({
      stopId: s.id, tripId: s.tripId, tripCode: s.trip.code, orderId: s.orderId, orderCode: s.order.code, partnerName: s.order.partner.name, phone: s.order.partner.phone, address: s.order.partner.address,
      result: s.result!, resultLabel: RESULT_LABEL[s.result!], note: s.resultNote, remainingQty: remaining.toString(), at: s.resultAt, handledNote: s.handledNote, handledAt: s.handledAt, returnedQty: returned.toString(), activeTripId: s.order.tripStops[0]?.tripId ?? null, activeTripCode: s.order.tripStops[0]?.trip.code ?? null,
    })),
  };
}
