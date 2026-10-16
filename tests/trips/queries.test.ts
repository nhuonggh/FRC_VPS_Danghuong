import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { getTrip, listTripOptions, listTrips, listUndelivered, searchTripOrders, TRIP_FILTER_KEYS, UNDELIVERED_FILTER_KEYS } from "@/server/trips/queries";
import { tripResultSchema, tripSchema } from "@/server/trips/schemas";
import { createTrip, handleStop, recordTripResult, settleTrip } from "@/server/trips/service";
import { cancelReturnTx, createReturnByOrderIdempotent } from "@/server/returns/service";
import { returnByOrderSchema } from "@/server/returns/schemas";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner } from "../helpers/factories";
import { buy, engine, newWorld, T, useNoopCostOwners as installNoopCostOwners, type World } from "../inventory/helpers";

installNoopCostOwners();
const NOW = new Date("2026-09-15T03:00:00Z");
const KT: Actor = { userId: 0, perms: new Set(["trip.manage", "trip.settle", "order.create", "sale_price.view", "order.edit_price", "partner.view_all"]) };
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let customer: { id: number }; let vehicle: { id: number }; let driver: { id: number };
let n = 0;
const P = (sp: Record<string, string> = {}, keys: readonly string[] = TRIP_FILTER_KEYS) => parseListParams(sp, keys);
const order = (over: { qty?: number; partnerId?: number } = {}) => createSaleOrderIdempotent(prisma, KT, `q-${++n}`, saleOrderSchema.parse({ partnerId: over.partnerId ?? customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-16", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: over.qty ?? 4, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: null, note: "" }] }), NOW);
const trip = (orderIds: number[], over: Record<string, unknown> = {}) => tx((t) => createTrip(t, KT, tripSchema.parse({ date: "2026-09-16", routeId: null, vehicleId: vehicle.id, driverId: driver.id, assistantId: null, note: "", orderIds, ...over }), NOW));
const result = (tripId: number, orderId: number, over: Record<string, unknown> = {}) => tx((t) => recordTripResult(t, KT, tripId, tripResultSchema.parse({ orderId, result: "GIAO_DU", cashAmount: 200_000, ...over }), NOW));

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1); KT.userId = w.userId;
  customer = await makePartner({ isCustomer: true, name: "Khách Đạt", searchText: "khach dat", address: "Q12", phone: "0912" });
  vehicle = await prisma.vehicle.create({ data: { plate: "51C-12345" } }); driver = await prisma.driver.create({ data: { name: "Lái A" } });
  await makeCashAccount();
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
});

describe("tìm đơn để xếp chuyến", () => {
  const back = async (orderId: number, qty: number) => {
    const line = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId } });
    return createReturnByOrderIdempotent(prisma, { ...KT, perms: new Set([...KT.perms, "return.manage"]) }, `back-${++n}`, returnByOrderSchema.parse({ orderId, date: "2026-09-15", note: "", undelivered: true, lines: [{ orderLineId: line.id, qty }] }), NOW);
  };
  it("trả hết kho thì không còn ở xếp chuyến và API chặn xếp; hủy phiếu trả thì xuất hiện lại", async () => {
    const o = await order(), t = await trip([o.id]);
    await result(t.id, o.id, { result: "KHONG_GIAO", cashAmount: 0, note: "khách vắng" });
    const r = await back(o.id, 4);
    expect(await searchTripOrders(prisma, KT, o.code)).toEqual([]);
    await expect(trip([o.id], { date: "2026-09-17" })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("không còn hàng để giao") });
    expect((await listUndelivered(prisma, KT, P({}, UNDELIVERED_FILTER_KEYS))).total).toBe(0);
    expect((await listUndelivered(prisma, KT, P({ state: "completed" }, UNDELIVERED_FILTER_KEYS))).rows[0]).toMatchObject({ remainingQty: "0", returnedQty: "4" });
    await cancelReturnTx(prisma, { ...KT, perms: new Set([...KT.perms, "return.manage"]) }, r.id, "nhập nhầm");
    expect((await searchTripOrders(prisma, KT, o.code))[0]).toMatchObject({ remainingQty: "4" });
  });
  it("trả một phần chỉ xếp/giao đủ số còn lại; ghi nhận hướng xử lý không loại đơn khỏi xếp chuyến", async () => {
    const o = await order(), t = await trip([o.id]);
    const failed = await result(t.id, o.id, { result: "KHONG_GIAO", cashAmount: 0, note: "khách vắng" });
    await back(o.id, 3);
    await tx((x) => handleStop(x, KT, failed.stopId, "sẽ giao lại", NOW));
    expect((await searchTripOrders(prisma, KT, o.code))[0]).toMatchObject({ remainingQty: "1" });
    expect((await listUndelivered(prisma, KT, P({ state: "handled" }, UNDELIVERED_FILTER_KEYS))).rows[0]).toMatchObject({ remainingQty: "1", returnedQty: "3", handledNote: "sẽ giao lại" });
    const retry = await trip([o.id], { date: "2026-09-17" });
    expect((await getTrip(prisma, KT, retry.id)).stops[0]!.lines[0]!.remaining).toBe("1");
    expect((await listUndelivered(prisma, KT, P({ state: "handled" }, UNDELIVERED_FILTER_KEYS))).rows[0]).toMatchObject({ activeTripId: retry.id, activeTripCode: retry.code });
    await result(retry.id, o.id, { cashAmount: 50_000 });
    expect(await searchTripOrders(prisma, KT, o.code)).toEqual([]);
    expect((await listUndelivered(prisma, KT, P({ state: "completed" }, UNDELIVERED_FILTER_KEYS))).rows[0]).toMatchObject({ remainingQty: "0", returnedQty: "3" });
  });
  it("chỉ đơn còn hàng phải giao, chưa nằm chuyến đang chạy; tìm theo mã/khách; đơn hẹn sớm lên trước", async () => {
    const a = await order(); const b = await order(); const c = await order();
    await trip([a.id]);
    expect((await searchTripOrders(prisma, KT, "")).map((o) => o.id).sort()).toEqual([b.id, c.id].sort());
    expect((await searchTripOrders(prisma, KT, "dat")).length).toBe(2);
    expect((await searchTripOrders(prisma, KT, "khong co")).length).toBe(0);
    expect((await searchTripOrders(prisma, KT, b.code))[0]).toMatchObject({ id: b.id, partnerName: "Khách Đạt", address: "Q12", remainingQty: "4" });
    await expect(searchTripOrders(prisma, { userId: 1, perms: new Set() }, "")).rejects.toMatchObject({ status: 403 });
  });
});

describe("danh sách và chi tiết chuyến", () => {
  it("delivery-results metrics include all filtered trips beyond the page and exclude cancelled money", async () => {
    const a = await order(), pendingOrder = await order(), paidOrder = await order(), cancelledOrder = await order();
    const waiting = await trip([a.id, pendingOrder.id]);
    await result(waiting.id, a.id, { cashAmount: 150000 });
    const paid = await trip([paidOrder.id], { date: "2026-09-17" });
    await result(paid.id, paidOrder.id);
    const cancelled = await trip([cancelledOrder.id], { date: "2026-09-18" });
    await result(cancelled.id, cancelledOrder.id);
    await prisma.trip.update({ where: { id: cancelled.id }, data: { status: "CANCELLED", cancelledAt: NOW, cancelledBy: KT.userId, cancelReason: "Kiểm thử" } });
    const all = await listTrips(prisma, KT, { ...P(), pageSize: 1 }, { resultsSummary: true });
    expect(all.rows).toHaveLength(1);
    expect(all.resultsSummary).toMatchObject({ total: 3, stops: 3, completed: 2, pending: 1, expected: "400000", collected: "350000", outstanding: "50000", paidTrips: 1, unpaidTrips: 1, filteredExpected: "400000", filteredCollected: "350000" });
    expect((await listTrips(prisma, KT, P({ route: "none" }))).total).toBe(3);
    const unpaid = await listTrips(prisma, KT, P({ collection: "unpaid" }), { resultsSummary: true });
    expect(unpaid.total).toBe(1);
    expect(unpaid.resultsSummary).toMatchObject({ total: 3, filteredExpected: "200000", filteredCollected: "150000", tabPaidTrips: 1, tabUnpaidTrips: 1, tabAllTrips: 3 });
    const completed = await listTrips(prisma, KT, P({ status: "RETURNED" }), { resultsSummary: true });
    expect(completed.resultsSummary).toMatchObject({ tabAllTrips: 1, tabPaidTrips: 1, filteredExpected: "200000", filteredCollected: "200000" });
  });
  it("multi-customer and route filters combine; tab counts preserve filters without the selected status", async () => {
    const other = await makePartner({ isCustomer: true });
    const routeA = await prisma.route.create({ data: { name: "Tuyến A" } });
    const routeB = await prisma.route.create({ data: { name: "Tuyến B" } });
    const pending = await trip([(await order()).id], { routeId: routeA.id });
    const paidOrder = await order(), partialOrder = await order();
    const paid = await trip([paidOrder.id], { routeId: routeA.id, date: "2026-09-17" });
    const partial = await trip([partialOrder.id], { routeId: routeA.id, date: "2026-09-18" });
    await trip([(await order({ partnerId: other.id })).id], { routeId: routeB.id, date: "2026-09-19" });
    await result(paid.id, paidOrder.id);
    await result(partial.id, partialOrder.id, { cashAmount: 150000 });
    const all = await listTrips(prisma, KT, P({ customer: `${customer.id},${other.id}`, route: `${routeA.id},${routeB.id}` }));
    expect(all.total).toBe(4);
    const selected = await listTrips(prisma, KT, P({ customer: String(customer.id), route: String(routeA.id), status: "RETURNED" }));
    expect(selected.total).toBe(2);
    expect(selected.stats).toMatchObject({ all: 3, counts: { PLANNED: 1, RETURNED: 2 } });
    const dated = await listTrips(prisma, KT, P({ timePreset: "custom", timeStart: "2026-09-17", timeEnd: "2026-09-17" }));
    expect(dated.rows.map((r) => r.id)).toEqual([paid.id]);
    expect(dated.stats).toMatchObject({ all: 1, counts: { PLANNED: 0, RETURNED: 1 } });
    const paidOnly = await listTrips(prisma, KT, P({ collection: "paid" }));
    expect(paidOnly.rows.map((r) => r.id)).toEqual([paid.id]);
    const unpaid = await listTrips(prisma, KT, P({ customer: String(customer.id), collection: "unpaid" }));
    expect(unpaid.rows.map((r) => r.id).sort()).toEqual([pending.id, partial.id].sort());
    expect(unpaid.rows.every((r) => r.collectionStatus === "unpaid")).toBe(true);
    expect((await listTrips(prisma, KT, P({ customer: "invalid" }))).total).toBe(0);
    expect((await listTrips(prisma, KT, P({ status: "RETURNED,RETURNED" }))).total).toBe(2);
  });
  it("collection status handles discounts per stop and never offsets another customer's debt with overpayment", async () => {
    const a = await order(), b = await order(), discounted = await order();
    const mixed = await trip([a.id, b.id]);
    await result(mixed.id, a.id, { cashAmount: 400000, note: "Trả nợ cũ" });
    await result(mixed.id, b.id, { cashAmount: 0 });
    const cleared = await trip([discounted.id], { date: "2026-09-17" });
    await result(cleared.id, discounted.id, { cashAmount: 150000, discountAmount: 50000, note: "Bớt tiền" });
    const paid = await listTrips(prisma, KT, P({ collection: "paid" }));
    expect(paid.rows.map((r) => r.id)).toEqual([cleared.id]);
    expect((await listTrips(prisma, KT, P({ collection: "unpaid" }))).rows.map((r) => r.id)).toEqual([mixed.id]);
    await prisma.trip.update({ where: { id: cleared.id }, data: { status: "CANCELLED", cancelledAt: NOW, cancelledBy: KT.userId, cancelReason: "Kiểm thử trạng thái hủy" } });
    expect((await listTrips(prisma, KT, P({ collection: "paid" }))).total).toBe(0);
    expect((await listTrips(prisma, KT, P({ status: "CANCELLED" }))).rows[0].collectionStatus).toBeNull();
  });
  it("đếm theo trạng thái, lọc, tổng phải thu/đã thu, số điểm đã có kết quả", async () => {
    const [a, b] = [await order(), await order()];
    const t1 = await trip([a.id, b.id]);
    await result(t1.id, a.id);
    const d2 = await prisma.driver.create({ data: { name: "Lái B" } });
    const t2 = await trip([(await order()).id], { date: "2026-09-17", driverId: d2.id });
    const all = await listTrips(prisma, KT, P());
    expect(all.total).toBe(2); expect(all.stats).toMatchObject({ active: 2, returned: 0 });
    const row = all.rows.find((r) => r.id === t1.id)!;
    expect(row).toMatchObject({ stops: 2, done: 1, expected: "200000", collected: "200000", vehiclePlate: "51C-12345", driverName: "Lái A" });
    expect(Number(row.cash) + Number(row.transfer)).toBe(200000);
    expect((await listTrips(prisma, KT, P({ q: "lái b" }))).rows.map((r) => r.id)).toEqual([t2.id]);
    expect((await listTrips(prisma, KT, P({ status: "RETURNED" }))).total).toBe(0);
    expect((await listTrips(prisma, KT, P(), { statuses: ["PLANNED", "ON_ROAD"] })).total).toBe(2);
    await result(t1.id, b.id);
    expect((await listTrips(prisma, KT, P())).stats).toMatchObject({ active: 1, returned: 1 });
    await expect(listTrips(prisma, { userId: 1, perms: new Set() }, P())).rejects.toMatchObject({ status: 403 });
  });
  it("chi tiết: điểm giao có khách/địa chỉ, dòng còn lại, gợi ý phải thu; tổng chênh lệch; snapshot đối soát", async () => {
    const a = await order();
    const t = await trip([a.id]);
    const before = await getTrip(prisma, KT, t.id);
    expect(before.stops[0]).toMatchObject({ orderCode: a.code, partnerName: "Khách Đạt", address: "Q12", suggestedDue: "200000", result: null });
    expect(before.stops[0]!.lines[0]).toMatchObject({ qty: "4", delivered: "0", remaining: "4" });
    await result(t.id, a.id, { cashAmount: 150_000 });
    const after = await getTrip(prisma, KT, t.id);
    expect(after.totals).toMatchObject({ expected: "200000", cash: "150000", diff: "50000" });
    expect(after.status).toBe("RETURNED");
    await tx((x) => settleTrip(x, KT, t.id, "thiếu 50k", NOW));
    const done = await getTrip(prisma, KT, t.id);
    expect(done.settled).toMatchObject({ diffReason: "thiếu 50k" });
    await expect(getTrip(prisma, KT, 99999)).rejects.toMatchObject({ status: 404 });
  });
  it("tuỳ chọn xếp chuyến: lái xe tách với phụ xe, chỉ mục đang bật", async () => {
    await prisma.driver.create({ data: { name: "Phụ B", isAssistant: true } }); await prisma.vehicle.create({ data: { plate: "OFF", isActive: false } });
    const o = await listTripOptions(prisma);
    expect(o.vehicles.map((v) => v.name)).toEqual(["51C-12345"]); expect(o.drivers.map((d) => d.name)).toEqual(["Lái A"]); expect(o.assistants.map((d) => d.name)).toEqual(["Phụ B"]);
  });
});

describe("hàng không giao được (42)", () => {
  it("liệt kê KHONG_GIAO và GIAO_MOT_PHAN còn hàng; giao hết / hủy đơn / đã xử lý thì rời danh sách", async () => {
    const [a, b] = [await order(), await order()];
    const line = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: b.id } });
    const t = await trip([a.id, b.id]);
    await result(t.id, a.id, { result: "KHONG_GIAO", cashAmount: 0, note: "khách vắng" });
    await result(t.id, b.id, { result: "GIAO_MOT_PHAN", lines: [{ orderLineId: line.id, qty: 1 }], cashAmount: 50_000 });
    const list = await listUndelivered(prisma, KT, P({}, UNDELIVERED_FILTER_KEYS));
    expect(list.rows.map((r) => [r.orderCode, r.result, r.remainingQty])).toEqual(expect.arrayContaining([[b.code, "GIAO_MOT_PHAN", "3"], [a.code, "KHONG_GIAO", "4"]]));
    expect(list.total).toBe(2);
    expect((await listUndelivered(prisma, KT, P({ result: "KHONG_GIAO" }, UNDELIVERED_FILTER_KEYS))).rows.map((r) => r.orderCode)).toEqual([a.code]);
    expect((await listUndelivered(prisma, KT, P({ q: "dat" }, UNDELIVERED_FILTER_KEYS))).total).toBe(2);
    // giao nốt phần còn lại ở chuyến sau ⇒ đơn b rời danh sách
    const t2 = await trip([b.id], { date: "2026-09-17" });
    await result(t2.id, b.id, { cashAmount: 150_000 });
    expect((await listUndelivered(prisma, KT, P({}, UNDELIVERED_FILTER_KEYS))).rows.map((r) => r.orderCode)).toEqual([a.code]);
    await expect(listUndelivered(prisma, { userId: 1, perms: new Set() }, P({}, UNDELIVERED_FILTER_KEYS))).rejects.toMatchObject({ status: 403 });
  });
});
