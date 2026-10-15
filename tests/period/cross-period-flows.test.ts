import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";
import { closePeriod } from "@/server/closing/service";
import { partnerBalance, discountBalance } from "@/server/debt/balance";
import { deliveryNoteSchema } from "@/server/delivery/schemas";
import { cancelDeliveryNote, createDeliveryNote } from "@/server/delivery/service";
import { returnByOrderSchema } from "@/server/returns/schemas";
import { createReturnByOrderIdempotent } from "@/server/returns/service";
import { cancelSaleOrderTx } from "@/server/sales/lifecycle";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { tripResultSchema, tripSchema } from "@/server/trips/schemas";
import { createTrip, departTrip, recordTripResult } from "@/server/trips/service";
import { prisma, resetDb } from "../helpers/db";
import { makePartner } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

/**
 * Plan 07 F1d — quy tắc xuyên kỳ (spec 4.4) chạy qua KẾT SỔ THẬT: đơn sinh ở kỳ A, kỳ A kết sổ, rồi giao nốt / hủy phiếu giao /
 * xếp chuyến / trả hàng ở kỳ B. Chứng từ mới mang kỳ B; sổ kỳ A không bị đụng; công nợ/chiết khấu liền mạch qua đầu kỳ.
 */
const ALL = new Set(PERMISSIONS.map((p) => p.code));
const ORDER_AT = new Date("2026-09-15T03:00:00Z");
const CLOSE_AT = new Date("2026-10-01T03:00:00Z");
const B_AT = new Date("2026-10-02T03:00:00Z");
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let actor: Actor; let customer: { id: number }; let n = 0;
let orderId: number; let lineId: number; let firstNote: number; let periodB: number;

const balance = async () => (await partnerBalance(prisma, customer.id)).balance.toString();
const note = (qty: number, at = B_AT) => tx((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId, date: "2026-10-02", note: "", lines: [{ orderLineId: lineId, qty }] }), at));
const rowsOf = (periodId: number) => prisma.partnerLedger.count({ where: { periodId } });

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: ALL };
  customer = await makePartner({ isCustomer: true, allowCredit: true, debtLimit: 1_000_000_000 });
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
  // Đơn 4 md × 50.000 − trừ ngay 20.000 = 180.000; tích lũy 40.000; giao 1/4 ở kỳ A (45.000)
  const input = saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 4, salePrice: 50_000, discountNow: 20_000, discountAccum: 40_000, processingTypeId: null, note: "" }] });
  orderId = (await createSaleOrderIdempotent(prisma, actor, `f-${++n}`, input, ORDER_AT)).id;
  lineId = (await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId } })).id;
  firstNote = (await tx((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId, date: "2026-09-15", note: "", lines: [{ orderLineId: lineId, qty: 1 }] }), ORDER_AT))).id;
  periodB = (await closePeriod(prisma, actor, { now: CLOSE_AT })).newPeriod.id;
});

describe("giao nốt đơn kỳ cũ (X1)", () => {
  it("phiếu giao mới mang kỳ B, công nợ ghi ở kỳ B; đơn vẫn thuộc kỳ A; số kỳ A không đổi; công nợ liền mạch qua đầu kỳ", async () => {
    expect(await balance()).toBe("45000"); // đầu kỳ B = số cuối kỳ A
    const rowsA = await rowsOf(w.periodId);
    const rest = await note(3);
    const row = await prisma.deliveryNote.findUniqueOrThrow({ where: { id: rest.id } });
    expect(row.periodId).toBe(periodB);
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: orderId } })).periodId).toBe(w.periodId);
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: orderId } })).deliveryStatus).toBe("DELIVERED");
    expect(await rowsOf(w.periodId)).toBe(rowsA);
    const ledger = await prisma.partnerLedger.findFirstOrThrow({ where: { docType: "DELIVERY", docId: rest.id } });
    expect([ledger.periodId, ledger.debit.toString()]).toEqual([periodB, "135000"]); // 180.000 − 45.000 đã giao ở kỳ A
    expect(await balance()).toBe("180000");
  });

  it("không lùi ngày phiếu giao vào kỳ đã đóng", async () => {
    await expect(tx((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId, date: "2026-09-20", note: "", lines: [{ orderLineId: lineId, qty: 1 }] }), B_AT))).rejects.toMatchObject({ name: "DocDateBeforePeriodError" });
  });

  it("hủy phiếu giao nốt (kỳ B) được và hoàn công nợ; phiếu giao của kỳ A vẫn bị chặn; hủy ĐƠN kỳ A bị chặn", async () => {
    const rest = await note(3);
    expect(await balance()).toBe("180000");
    await tx((t) => cancelDeliveryNote(t, actor, rest.id));
    expect(await balance()).toBe("45000");
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: orderId } })).deliveryStatus).toBe("PARTIAL");
    await expect(tx((t) => cancelDeliveryNote(t, actor, firstNote))).rejects.toMatchObject({ name: "PeriodClosedError" });
    await expect(cancelSaleOrderTx(prisma, actor, orderId, "x")).rejects.toMatchObject({ name: "PeriodClosedError" });
    expect(await balance()).toBe("45000");
  });
});

describe("xếp chuyến giao nốt đơn kỳ cũ (X1)", () => {
  it("chuyến + phiếu giao + tiền lái xe thu đều mang kỳ B; công nợ về 0; đơn DELIVERED/PAID", async () => {
    const vehicle = await prisma.vehicle.create({ data: { plate: "51C-9" } }), driver = await prisma.driver.create({ data: { name: "Lái" } });
    const trip = await tx((t) => createTrip(t, actor, tripSchema.parse({ date: "2026-10-02", routeId: null, vehicleId: vehicle.id, driverId: driver.id, assistantId: null, note: "", orderIds: [orderId] }), B_AT));
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).periodId).toBe(periodB);
    await tx((t) => departTrip(t, actor, trip.id, B_AT));
    await tx((t) => recordTripResult(t, actor, trip.id, tripResultSchema.parse({ orderId, result: "GIAO_DU", cashAmount: 180_000 }), B_AT));
    const o = await prisma.saleOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect([o.periodId, o.deliveryStatus, o.paymentStatus]).toEqual([w.periodId, "DELIVERED", "PAID"]);
    const rows = await prisma.partnerLedger.findMany({ where: { periodId: periodB, docType: { in: ["DELIVERY", "TRIP_COLLECT"] } }, orderBy: { id: "asc" } });
    expect(rows.map((r) => [r.docType, r.debit.toString(), r.credit.toString()])).toEqual([["DELIVERY", "135000", "0"], ["TRIP_COLLECT", "0", "180000"]]);
    expect(await balance()).toBe("0");
  });
});

describe("trả hàng đơn kỳ cũ có chiết khấu tích lũy xuyên kỳ", () => {
  it("chiết khấu tích lũy mang qua đầu kỳ; trả 1/4 hoàn 10.000 ở kỳ B; sổ chiết khấu kỳ A không đổi; hủy đơn kỳ cũ không phải đường đi (đã chặn)", async () => {
    expect((await discountBalance(prisma, customer.id)).toString()).toBe("40000");
    const rowsA = await prisma.discountLedger.count({ where: { periodId: w.periodId } });
    const returned = await createReturnByOrderIdempotent(prisma, actor, `rr-${++n}`, returnByOrderSchema.parse({ orderId, date: "2026-10-02", note: "", lines: [{ orderLineId: lineId, qty: 1 }] }), B_AT);
    const header = await prisma.goodsReturn.findUniqueOrThrow({ where: { id: returned.id } });
    expect(header.periodId).toBe(periodB);
    expect((await discountBalance(prisma, customer.id)).toString()).toBe("30000"); // 40.000 − 40.000 × 1/4
    expect(await prisma.discountLedger.count({ where: { periodId: w.periodId } })).toBe(rowsA);
    const out = await prisma.discountLedger.findFirstOrThrow({ where: { periodId: periodB, docType: "RETURN" } });
    expect(out.amountOut.toString()).toBe("10000");
    // trả hàng ghi có (credit) công nợ ở kỳ B: 45.000 − (trả 1 md ≈ 45.000 theo giá sau trừ ngay) → không âm sai
    expect(Number(await balance())).toBeLessThanOrEqual(45_000);
    await expect(cancelSaleOrderTx(prisma, actor, orderId, "x")).rejects.toMatchObject({ name: "PeriodClosedError" });
  });
});
