import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { cashBalance } from "@/server/cash/balance";
import { cancelVoucher, reviewVoucher } from "@/server/cash/vouchers";
import { partnerBalance } from "@/server/debt/balance";
import { syncPaymentStatus } from "@/server/deposits/status";
import { cancelSaleOrderTx } from "@/server/sales/lifecycle";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { confirmTripSchema, tripResultSchema, tripSchema } from "@/server/trips/schemas";
import { cancelTrip, clearTripResult, confirmTripCash, createTrip, createTripIdempotent, departTrip, handleStop, recordTripResult, settleTrip } from "@/server/trips/service";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner } from "../helpers/factories";
import { buy, engine, newWorld, T, useNoopCostOwners, type World } from "../inventory/helpers";

useNoopCostOwners();
const NOW = new Date("2026-09-15T03:00:00Z");
const KT = ["trip.manage", "trip.settle", "order.create", "order.cancel", "order.edit", "sale_price.view", "order.edit_price", "partner.view_all"];
const TQ = ["trip.confirm_cash", "cash.review", "partner.view_all"];
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let kt: Actor; let tq: Actor; let customer: { id: number }; let cash: { id: number }; let bank: { id: number };
let vehicle: { id: number }; let driver: { id: number }; let assistant: { id: number }; let route: { id: number };
let n = 0;
const order = async (over: { partnerId?: number; qty?: number } = {}) => createSaleOrderIdempotent(prisma, kt, `o-${++n}`, saleOrderSchema.parse({ partnerId: over.partnerId ?? customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: over.qty ?? 4, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: null, note: "" }] }), NOW);
const trip = (orderIds: number[], over: Record<string, unknown> = {}) => tx((t) => createTrip(t, kt, tripSchema.parse({ date: "2026-09-16", routeId: route.id, vehicleId: vehicle.id, driverId: driver.id, assistantId: assistant.id, note: "", orderIds, ...over }), NOW));
const result = (tripId: number, orderId: number, over: Record<string, unknown> = {}, at = NOW) => tx((t) => recordTripResult(t, kt, tripId, tripResultSchema.parse({ orderId, result: "GIAO_DU", cashAmount: 200_000, ...over }), at));
const bal = async (pid = customer.id) => (await partnerBalance(prisma, pid)).balance.toString();
const st = async (id: number) => prisma.saleOrder.findUniqueOrThrow({ where: { id }, select: { deliveryStatus: true, paymentStatus: true } });
const errOf = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { status?: number; code?: string; message: string });
const TRIP_NOW = new Date("2026-09-16T03:00:00Z"); // ngày chuyến

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  kt = { userId: w.userId, perms: new Set(KT) };
  tq = { userId: (await prisma.user.create({ data: { username: "tq", passwordHash: "x", fullName: "Thủ quỹ" } })).id, perms: new Set(TQ) };
  customer = await makePartner({ isCustomer: true, allowCredit: true, debtLimit: 1_000_000 });
  cash = await makeCashAccount({ name: "Tiền mặt" }); bank = await makeCashAccount({ type: "BANK", name: "VCB" });
  vehicle = await prisma.vehicle.create({ data: { plate: "51C-12345" } }); driver = await prisma.driver.create({ data: { name: "Lái A" } }); assistant = await prisma.driver.create({ data: { name: "Phụ B", isAssistant: true } });
  route = await prisma.route.create({ data: { name: "Quận 12" } });
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
});

describe("xếp chuyến (38)", () => {
  it("tạo chuyến CH…, các điểm giao theo thứ tự, đơn chuyển READY; idempotent theo khoá", async () => {
    const a = await order(); const b = await order();
    const t = await trip([b.id, a.id]);
    expect(t.code).toMatch(/^CH\d{6}$/);
    const stops = await prisma.tripOrder.findMany({ where: { tripId: t.id }, orderBy: { seq: "asc" } });
    expect(stops.map((s) => s.orderId)).toEqual([b.id, a.id]);
    expect((await st(a.id)).deliveryStatus).toBe("READY");
    const c = await order();
    const input = tripSchema.parse({ date: "2026-09-17", routeId: null, vehicleId: vehicle.id, driverId: driver.id, assistantId: null, note: "", orderIds: [c.id] });
    await createTripIdempotent(prisma, kt, "k1", input, NOW); await createTripIdempotent(prisma, kt, "k1", input, NOW);
    expect(await prisma.trip.count()).toBe(2);
  });
  it("chống trùng xe/lái/phụ cùng ngày (kể cả người đổi vai), khác ngày thì được; hủy chuyến giải phóng", async () => {
    const [a, b, c] = [await order(), await order(), await order()];
    const t1 = await trip([a.id]);
    expect((await errOf(trip([b.id])))?.code).toBe("TRIP_CLASH");
    const v2 = await prisma.vehicle.create({ data: { plate: "51C-99999" } });
    expect((await errOf(trip([b.id], { vehicleId: v2.id, assistantId: null })))?.code).toBe("TRIP_CLASH"); // trùng lái
    const d2 = await prisma.driver.create({ data: { name: "Lái C" } });
    expect((await errOf(trip([b.id], { vehicleId: v2.id, driverId: d2.id })))?.code).toBe("TRIP_CLASH"); // trùng phụ
    await trip([b.id], { date: "2026-09-17" });
    await tx((t) => cancelTrip(t, kt, t1.id, "đổi kế hoạch", NOW));
    await trip([c.id]);
  });
  it("đơn đang nằm chuyến chưa có kết quả / nháp / đã hủy / đã giao hết / vai trò sai / ngày quá xa / thiếu quyền bị từ chối", async () => {
    const a = await order(); await trip([a.id]);
    const v2 = await prisma.vehicle.create({ data: { plate: "51C-1" } }); const d2 = await prisma.driver.create({ data: { name: "Lái D" } }); const asst2 = await prisma.driver.create({ data: { name: "Phụ E", isAssistant: true } });
    const other = { vehicleId: v2.id, driverId: d2.id, assistantId: asst2.id };
    expect((await errOf(trip([a.id], other)))?.code).toBe("ORDER_IN_TRIP");
    const c = await order(); await cancelSaleOrderTx(prisma, kt, c.id, "x");
    expect((await errOf(trip([c.id], other)))?.status).toBe(409);
    expect((await errOf(trip([await order().then((o) => o.id)], { ...other, driverId: assistant.id })))?.status).toBe(400); // phụ xe không làm lái
    expect((await errOf(trip([await order().then((o) => o.id)], { ...other, assistantId: driver.id })))?.status).toBe(400);
    expect((await errOf(trip([await order().then((o) => o.id)], { ...other, date: "2026-12-30" })))?.status).toBe(400);
    expect((await errOf(tx((t) => createTrip(t, { userId: 1, perms: new Set() }, tripSchema.parse({ date: "2026-09-16", routeId: null, vehicleId: v2.id, driverId: d2.id, assistantId: null, note: "", orderIds: [a.id] }), NOW))))?.status).toBe(403);
    expect(tripSchema.safeParse({ date: "2026-09-16", routeId: null, vehicleId: 1, driverId: 1, assistantId: null, note: "", orderIds: [] }).success).toBe(false);
    expect(tripSchema.safeParse({ date: "2026-09-16", routeId: null, vehicleId: 1, driverId: 1, assistantId: null, note: "", orderIds: [3, 3] }).success).toBe(false);
  });
  it("không hủy được đơn đang nằm trong chuyến; hủy chuyến trả đơn về chưa xếp; xuất phát → DELIVERING", async () => {
    const a = await order(); const t = await trip([a.id]);
    expect((await errOf(cancelSaleOrderTx(prisma, kt, a.id, "x")))?.code).toBe("IN_TRIP");
    await tx((x) => departTrip(x, kt, t.id, NOW));
    expect((await st(a.id)).deliveryStatus).toBe("DELIVERING");
    expect((await errOf(tx((x) => departTrip(x, kt, t.id, NOW))))?.status).toBe(409);
    await tx((x) => cancelTrip(x, kt, t.id, "xe hỏng", NOW));
    expect((await st(a.id)).deliveryStatus).toBe("NEW");
    await cancelSaleOrderTx(prisma, kt, a.id, "ok");
  });
});

describe("kết quả giao (40)", () => {
  it("giao đủ thu đủ: phiếu giao + công nợ debit, tiền lái xe thu = credit (nợ về 0), đơn DELIVERED/PAID, chuyến tự về RETURNED", async () => {
    const a = await order(); const t = await trip([a.id]);
    const r = await result(t.id, a.id);
    expect(r.due).toBe("200000");
    expect(await bal()).toBe("0");
    expect(await prisma.deliveryNote.count({ where: { orderId: a.id, isCancelled: false } })).toBe(1);
    expect(await st(a.id)).toEqual({ deliveryStatus: "DELIVERED", paymentStatus: "PAID" });
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("RETURNED");
    expect((await prisma.partnerLedger.findFirstOrThrow({ where: { docType: "TRIP_COLLECT" } })).credit.toString()).toBe("200000");
    expect((await cashBalance(prisma, w.periodId, cash.id)).balance.toString()).toBe("0"); // quỹ chính chưa nhận (D-35)
  });
  it("ghi nợ: kiểm allow_credit và hạn mức; thu một phần → PARTIAL; công nợ = phần ghi nợ", async () => {
    const a = await order(); const t = await trip([a.id]);
    await result(t.id, a.id, { result: "GHI_NO", cashAmount: 50_000, debtAmount: 150_000 });
    expect(await bal()).toBe("150000"); expect((await st(a.id)).paymentStatus).toBe("PARTIAL");
    const noCredit = await makePartner({ isCustomer: true, allowCredit: false }); const b = await order({ partnerId: noCredit.id }); const t2 = await trip([b.id], { date: "2026-09-17" });
    expect((await errOf(result(t2.id, b.id, { result: "GHI_NO", cashAmount: 0, debtAmount: 200_000 })))?.code).toBe("CREDIT_NOT_ALLOWED");
    const small = await makePartner({ isCustomer: true, allowCredit: true, debtLimit: 100_000 }); const c = await order({ partnerId: small.id }); const t3 = await trip([c.id], { date: "2026-09-18" });
    expect((await errOf(result(t3.id, c.id, { result: "GHI_NO", cashAmount: 0, debtAmount: 200_000 })))?.code).toBe("CREDIT_LIMIT");
    expect(await prisma.deliveryNote.count({ where: { orderId: c.id, isCancelled: false } })).toBe(0); // rollback trọn
  });
  it("hẹn trả → PROMISED; không giao được → FAILED, không phiếu giao; tiền vượt phải thu bị chặn; schema bắt buộc lý do/ngày hẹn", async () => {
    const [a, b] = [await order(), await order()]; const t = await trip([a.id, b.id]);
    await result(t.id, a.id, { result: "HEN_TRA", cashAmount: 0, debtAmount: 200_000, promiseDate: "2026-09-20" });
    expect((await st(a.id)).paymentStatus).toBe("PROMISED");
    await result(t.id, b.id, { result: "KHONG_GIAO", cashAmount: 0, note: "khách vắng" });
    expect(await st(b.id)).toMatchObject({ deliveryStatus: "FAILED" });
    expect(await prisma.deliveryNote.count({ where: { orderId: b.id } })).toBe(0);
    const c = await order(); const t2 = await trip([c.id], { date: "2026-09-17" });
    expect((await errOf(result(t2.id, c.id, { cashAmount: 250_000 })))?.code).toBe("COLLECT_EXCEEDS_DUE");
    expect(tripResultSchema.safeParse({ orderId: 1, result: "HEN_TRA", debtAmount: 5 }).success).toBe(false);
    expect(tripResultSchema.safeParse({ orderId: 1, result: "KHONG_GIAO" }).success).toBe(false);
    expect(tripResultSchema.safeParse({ orderId: 1, result: "GHI_NO", cashAmount: 5 }).success).toBe(false);
    expect(tripResultSchema.safeParse({ orderId: 1, result: "GIAO_DU", debtAmount: 5 }).success).toBe(false);
    expect(tripResultSchema.safeParse({ orderId: 1, result: "GIAO_MOT_PHAN" }).success).toBe(false);
  });
  it("giao một phần: chỉ ghi công nợ phần thực giao; đơn PARTIAL, còn hàng ⇒ xếp chuyến sau; chuyến sau giao nốt; phải thu cộng dồn nợ cũ", async () => {
    const a = await order(); const line = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: a.id } });
    const t1 = await trip([a.id]);
    await result(t1.id, a.id, { result: "GIAO_MOT_PHAN", lines: [{ orderLineId: line.id, qty: 1 }], cashAmount: 20_000, debtAmount: 30_000 });
    expect(await bal()).toBe("30000"); expect((await st(a.id)).deliveryStatus).toBe("PARTIAL");
    const t2 = await trip([a.id], { date: "2026-09-17" });
    const r = await result(t2.id, a.id, { cashAmount: 180_000 });
    expect(r.due).toBe("180000"); // 200.000 giá trị − 20.000 đã thu (nợ cũ 30.000 nằm trong phần phải thu còn lại)
    expect(await bal()).toBe("0"); // 30.000 nợ cũ + 150.000 giao thêm − 180.000 thu
    expect((await st(a.id)).deliveryStatus).toBe("DELIVERED");
    const c = await order(); const t3 = await trip([c.id], { date: "2026-09-18" });
    const cl = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: c.id } });
    expect((await errOf(result(t3.id, c.id, { result: "GIAO_MOT_PHAN", lines: [{ orderLineId: cl.id, qty: 4 }], cashAmount: 0 })))?.status).toBe(400);
    expect((await errOf(result(t3.id, c.id, { result: "GIAO_MOT_PHAN", lines: [{ orderLineId: cl.id, qty: 9 }], cashAmount: 0 })))?.status).toBe(400);
  });
  it("nhập lại kết quả thay thế (không nhân đôi phiếu giao/công nợ); xóa kết quả hoàn lại; chuyến đã về quay lại đang đi", async () => {
    const a = await order(); const t = await trip([a.id]);
    await result(t.id, a.id); await result(t.id, a.id, { cashAmount: 150_000, result: "GHI_NO", debtAmount: 50_000 });
    expect(await prisma.deliveryNote.count({ where: { orderId: a.id, isCancelled: false } })).toBe(1);
    expect(await prisma.partnerLedger.count({ where: { docType: "TRIP_COLLECT" } })).toBe(1);
    expect(await bal()).toBe("50000");
    await tx((x) => clearTripResult(x, kt, t.id, a.id));
    expect(await bal()).toBe("0"); expect(await prisma.partnerLedger.count()).toBe(0);
    expect(await st(a.id)).toEqual({ deliveryStatus: "DELIVERING", paymentStatus: "UNPAID" });
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("ON_ROAD");
    expect((await errOf(tx((x) => clearTripResult(x, kt, t.id, a.id))))?.status).toBe(409);
  });
});

describe("đối soát (41) và thủ quỹ xác nhận (D-35)", () => {
  const twoStops = async () => {
    const [a, b] = [await order(), await order()]; const t = await trip([a.id, b.id]);
    await result(t.id, a.id, { cashAmount: 150_000, transferAmount: 50_000 });
    await result(t.id, b.id, { result: "GHI_NO", cashAmount: 100_000, debtAmount: 100_000 });
    return { a, b, t };
  };
  it("tổng chuyến = Σ điểm; khớp thì đối soát không cần lý do; chuyến khoá kết quả sau đối soát", async () => {
    const { a, t } = await twoStops();
    const r = await tx((x) => settleTrip(x, kt, t.id, "", NOW));
    expect(r.diff).toBe("0");
    const row = await prisma.trip.findUniqueOrThrow({ where: { id: t.id } });
    expect([row.status, String(row.expectedAmount), String(row.cashAmount), String(row.transferAmount), String(row.debtAmount)]).toEqual(["SETTLED", "400000", "250000", "50000", "100000"]);
    expect((await errOf(result(t.id, a.id)))?.code).toBe("TRIP_LOCKED");
    expect((await errOf(tx((x) => settleTrip(x, kt, t.id, "", NOW))))?.status).toBe(409);
  });
  it("chênh lệch ≠ 0 bắt buộc lý do; chưa đủ kết quả không đối soát được; cần quyền trip.settle", async () => {
    const a = await order(); const t = await trip([a.id]);
    expect((await errOf(tx((x) => settleTrip(x, kt, t.id, "", NOW))))?.code).toBe("TRIP_NOT_READY");
    await result(t.id, a.id, { cashAmount: 150_000 }); // phải thu 200.000, chỉ ghi 150.000 ⇒ lệch 50.000
    expect((await errOf(tx((x) => settleTrip(x, kt, t.id, "", NOW))))?.code).toBe("DIFF_REASON_REQUIRED");
    expect((await errOf(tx((x) => settleTrip(x, tq, t.id, "x", NOW))))?.status).toBe(403);
    expect((await tx((x) => settleTrip(x, kt, t.id, "lái xe thiếu 50k, đã nhắc", NOW))).diff).toBe("50000");
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: t.id } })).diffReason).toBe("lái xe thiếu 50k, đã nhắc");
  });
  it("thủ quỹ xác nhận: sinh phiếu thu tiền mặt → quỹ, CK → NH (chờ kiểm, gắn chuyến), công nợ KHÔNG đổi, không tính tiền hai lần; xác nhận hai lần/đồng thời chỉ một lần", async () => {
    const { a, t } = await twoStops();
    await tx((x) => settleTrip(x, kt, t.id, "", NOW));
    const balBefore = await bal();
    expect((await errOf(tx((x) => confirmTripCash(x, kt, t.id, { cashAccountId: cash.id, transferAccountId: bank.id }, NOW))))?.status).toBe(403);
    expect((await errOf(tx((x) => confirmTripCash(x, tq, t.id, { cashAccountId: null, transferAccountId: bank.id }, NOW))))?.status).toBe(400);
    expect((await errOf(tx((x) => confirmTripCash(x, tq, t.id, { cashAccountId: cash.id, transferAccountId: null }, NOW))))?.status).toBe(400);
    const input = confirmTripSchema.parse({ cashAccountId: cash.id, transferAccountId: bank.id });
    const res = await Promise.all([tx((x) => confirmTripCash(x, tq, t.id, input, NOW)).then(() => "ok", (e) => e.status), tx((x) => confirmTripCash(x, tq, t.id, input, NOW)).then(() => "ok", (e) => e.status)]);
    expect(res.sort()).toEqual([409, "ok"]);
    const receipts = await prisma.receipt.findMany({ where: { tripId: t.id }, orderBy: { id: "asc" } });
    expect(receipts.map((r) => [r.cashAccountId === cash.id ? "cash" : "bank", String(r.amount), r.reviewStatus, r.type])).toEqual([["cash", "150000", "PENDING_REVIEW", "THU_NO"], ["bank", "50000", "PENDING_REVIEW", "THU_NO"], ["cash", "100000", "PENDING_REVIEW", "THU_NO"]]);
    expect((await cashBalance(prisma, w.periodId, cash.id)).balance.toString()).toBe("250000"); expect((await cashBalance(prisma, w.periodId, bank.id)).balance.toString()).toBe("50000");
    expect(await bal()).toBe(balBefore); // công nợ đã ghi có từ lúc nhập kết quả
    await tx((x) => syncPaymentStatus(x, a.id));
    expect((await st(a.id)).paymentStatus).toBe("PAID"); // tiền không bị tính hai lần
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("CONFIRMED");
    // phiếu sinh từ chuyến không sửa/hủy trực tiếp; thủ quỹ vẫn kiểm được
    expect((await errOf(tx((x) => cancelVoucher(x, { userId: 1, perms: new Set(["receipt.manage", "cash.transaction.edit_pending"]) }, "RECEIPT", receipts[0]!.id, "x", NOW))))?.code).toBe("TRIP_VOUCHER");
    await tx((x) => reviewVoucher(x, tq, "RECEIPT", receipts[0]!.id));
  });
  it("tiền lái xe thu chưa vào quỹ trước khi thủ quỹ xác nhận; hủy chuyến đã có kết quả bị chặn", async () => {
    const { t } = await twoStops();
    expect((await cashBalance(prisma, w.periodId, cash.id)).balance.toString()).toBe("0");
    expect((await errOf(tx((x) => cancelTrip(x, kt, t.id, "x", NOW))))?.code).toBe("TRIP_HAS_RESULTS");
    expect((await errOf(tx((x) => confirmTripCash(x, tq, t.id, { cashAccountId: cash.id, transferAccountId: bank.id }, NOW))))?.code).toBe("TRIP_NOT_SETTLED");
  });
});

describe("hàng không giao được (42)", () => {
  it("ghi nhận đã xử lý một lần; chỉ áp cho KHONG_GIAO / GIAO_MOT_PHAN", async () => {
    const [a, b] = [await order(), await order()]; const t = await trip([a.id, b.id]);
    await result(t.id, a.id, { result: "KHONG_GIAO", cashAmount: 0, note: "khách vắng" }); await result(t.id, b.id);
    const sa = await prisma.tripOrder.findFirstOrThrow({ where: { orderId: a.id } }); const sb = await prisma.tripOrder.findFirstOrThrow({ where: { orderId: b.id } });
    await tx((x) => handleStop(x, kt, sa.id, "giao lại thứ 6", NOW));
    expect((await errOf(tx((x) => handleStop(x, kt, sa.id, "x", NOW))))?.status).toBe(409);
    expect((await errOf(tx((x) => handleStop(x, kt, sb.id, "x", NOW))))?.status).toBe(404);
    expect((await prisma.tripOrder.findUniqueOrThrow({ where: { id: sa.id } })).handledNote).toBe("giao lại thứ 6");
  });
});
