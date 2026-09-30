import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { getTrip, listTripOptions, listTrips, listUndelivered, searchTripOrders, TRIP_FILTER_KEYS, UNDELIVERED_FILTER_KEYS } from "@/server/trips/queries";
import { tripResultSchema, tripSchema } from "@/server/trips/schemas";
import { createTrip, recordTripResult, settleTrip } from "@/server/trips/service";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner } from "../helpers/factories";
import { buy, engine, newWorld, T, useNoopCostOwners, type World } from "../inventory/helpers";

useNoopCostOwners();
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
