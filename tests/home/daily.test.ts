import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import { parseListParams } from "@/lib/query-params";
import type { Actor } from "@/lib/permissions/scope";
import { DAILY_ITEMS, visibleDailyItems } from "@/server/home/daily-config";
import { dailyRange, loadDailyItem, loadDailyPartners, loadDailySummary, pendingUndeliveredCount } from "@/server/home/daily";
import { exportDaily } from "@/server/home/daily-export";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makePeriod, makeProduct, makeUser, makeVehicle } from "../helpers/factories";

const now = new Date("2026-10-15T03:00:00Z");
const start = new Date("2026-10-14T17:00:00Z");
const params = parseListParams({ timePreset: "today" });
let actor: Actor, owner: number, stranger: number, partnerId: number;

describe("daily review and Excel (real test DB)", () => {
  beforeAll(async () => {
    await resetDb();
    owner = (await makeUser()).id; stranger = (await makeUser()).id;
    actor = { userId: owner, perms: new Set(PERMISSIONS.map((p) => p.code)) };
    const period = await makePeriod(), partner = await makePartner({ ownerUserId: owner }); partnerId = partner.id;
    const other = await makePartner({ ownerUserId: stranger }), product = await makeProduct(), account = await makeCashAccount();
    const base = { periodId: period.id, createdBy: owner };
    const baseOrder = await prisma.saleOrder.create({ data: { ...base, code: "DH-base", partnerId, orderDate: now, expectedDeliveryDate: now, originalDeliveryDate: now } });
    const otherOrder = await prisma.saleOrder.create({ data: { ...base, code: "DH-other", partnerId: other.id, orderDate: now, expectedDeliveryDate: now, originalDeliveryDate: now } });
    for (const [code, at, extra] of [
      ["R-start", start, {}], ["R-end", new Date("2026-10-15T17:00:00Z"), {}], ["R-before", new Date(start.getTime() - 1), {}],
      ["R-cancel", now, { isCancelled: true }], ["R-stock", now, { undelivered: true }],
      ["R-other", now, { partnerId: other.id, orderId: otherOrder.id }],
    ] as const) await prisma.goodsReturn.create({ data: { ...base, code, at, kind: "BY_ORDER", orderId: baseOrder.id, partnerId, totalAmount: 100, ...extra } });
    for (const kind of ["BY_PRODUCT", "SUPPLIER"] as const) await prisma.goodsReturn.create({ data: { ...base, code: `R-${kind}`, at: now, kind, partnerId, totalAmount: 200 } });
    const order = await prisma.saleOrder.create({ data: { ...base, code: "DH-discount", partnerId, orderDate: now, expectedDeliveryDate: now, originalDeliveryDate: now, orderDiscount: 20,
      lines: { create: [1, 2].map(() => ({ productId: product.id, qty: 10, qtyBase: 10, factorUsed: 1, unit: "md", salePrice: 100, discountNow: 15, discountOrder: 10, discountAccum: 25, at: now })) },
    }, include: { lines: true } });
    await prisma.saleOrder.create({ data: { ...base, code: "DH-draft", partnerId, orderDate: now, expectedDeliveryDate: now, originalDeliveryDate: now, isDraft: true, lines: { create: { productId: product.id, qty: 1, qtyBase: 1, factorUsed: 1, unit: "md", salePrice: 100, discountNow: 80, at: now } } } });
    await prisma.debtAdjustment.create({ data: { ...base, code: "DC-plus", partnerId, at: now, amount: 300, reason: "KHAC", note: "Tăng" } });
    await prisma.debtAdjustment.create({ data: { ...base, code: "DC-minus", partnerId, at: now, amount: -70, reason: "HANG_LOI", note: "Giảm" } });
    const dest = await makePartner({ ownerUserId: owner });
    await prisma.debtTransfer.create({ data: { ...base, code: "GC-1", kind: "MERGE", fromPartnerId: partnerId, toPartnerId: dest.id, amount: 400, discountMoved: 25, at: now } });
    const settlementPayment = await prisma.payment.create({ data: { ...base, code: "PC-settlement", at: now, amount: 50, cashAccountId: account.id, kind: "TAT_TOAN_CK" } });
    for (const method of ["CASH", "OFFSET"] as const) await prisma.discountSettlement.create({ data: { ...base, code: `CK-${method}`, partnerId, at: now, amount: 50, method, paymentId: method === "CASH" ? settlementPayment.id : null } });
    await prisma.receipt.create({ data: { ...base, code: "PT1", partnerId, at: now, amount: 500, cashAccountId: account.id, type: "THU_NO" } });
    await prisma.payment.create({ data: { ...base, code: "PC1", at: now, amount: 200, cashAccountId: account.id, kind: "KHAC" } });
    await prisma.purchase.create({ data: { ...base, code: "PN1", partnerId, at: now, purchaseTotal: 900, freightCost: 30 } });
    const adjustment = await prisma.stockAdjustment.create({ data: { ...base, code: "HH1", at: now, type: "LOSS", lines: { create: { productId: product.id, qty: 2, unitCost: 0 } } }, include: { lines: true } });
    await prisma.stockAdjustment.create({ data: { ...base, code: "XH1", at: now, type: "WRITE_OFF" } });
    const ledgerIn = await prisma.stockLedger.create({ data: { ...base, productId: product.id, docType: "PURCHASE", docId: 1, docLineId: 1, qtyIn: 10, at: now } });
    const layer = await prisma.costLayer.create({ data: { periodId: period.id, productId: product.id, sourceDocType: "PURCHASE", sourceDocId: 1, sourceLineId: 1, ledgerId: ledgerIn.id, qtyIn: 10, qtyRemaining: 8, unitCost: 40, at: now } });
    const ledgerOut = await prisma.stockLedger.create({ data: { ...base, productId: product.id, docType: "ADJ_LOSS", docId: adjustment.id, docLineId: adjustment.lines[0]!.id, qtyOut: 2, at: now } });
    await prisma.costConsumption.create({ data: { layerId: layer.id, ledgerId: ledgerOut.id, docType: "ADJ_LOSS", docLineId: adjustment.lines[0]!.id, qty: 2, unitCost: 40 } });
    const vehicle = await makeVehicle(), driver = await prisma.driver.create({ data: { name: "Lái xe kiểm thử" } });
    const trip = await prisma.trip.create({ data: { ...base, code: "CG1", tripDate: now, vehicleId: vehicle.id, driverId: driver.id } });
    await prisma.tripOrder.create({ data: { tripId: trip.id, orderId: order.id, seq: 1, result: "GIAO_MOT_PHAN", resultAt: now } });
    await prisma.goodsReturn.create({ data: { ...base, code: "R-partial", kind: "BY_ORDER", partnerId, orderId: order.id, at: now, totalAmount: 10, undelivered: true, lines: { create: { productId: product.id, orderLineId: order.lines[0]!.id, qty: 2, qtyBase: 2, factorUsed: 1, unit: "md", unitPrice: 5, amount: 10, at: now } } } });
  });

  it("all twelve sources execute and errors are not silently converted to zero", async () => {
    const summary = await loadDailySummary(prisma, actor, params, now);
    expect(summary).toHaveLength(12);
    for (const r of summary) expect(r.totals, r.item.key).not.toBeNull();
    for (const item of DAILY_ITEMS) expect((await loadDailyItem(prisma, actor, item.key, params, now)).rows.length).toBeGreaterThan(0);
  });
  it("partner options and exact partner filters execute against the permitted document sources", async () => {
    const partner = await prisma.partner.findUniqueOrThrow({ where: { id: partnerId } });
    const scoped = { userId: owner, perms: new Set(["order.view"]) };
    expect(await loadDailyPartners(prisma, scoped, params, now)).toEqual([partner.name]);
    const selected = { ...params, filters: { partner: [partner.name] } };
    expect(await loadDailyPartners(prisma, actor, selected, now)).toContain(partner.name);
    expect((await loadDailyItem(prisma, scoped, "discount-orders", selected, now)).totals.count).toBe(1);
    expect((await loadDailyItem(prisma, scoped, "discount-orders", { ...params, filters: { partner: ["Không tồn tại"] } }, now)).totals.count).toBe(0);
  });
  it("ICT range includes midnight start, excludes next midnight and separates undelivered returns", async () => {
    const scoped = { userId: owner, perms: new Set(["return.manage", "sale_price.view"]) };
    const r = await loadDailyItem(prisma, scoped, "return-order", params, now);
    expect(r.rows.map((d) => d.code)).toEqual(["R-start"]);
    expect(r.totals.amount).toBe("100");
    const cancelled = await loadDailyItem(prisma, scoped, "return-order", { ...params, filters: { state: ["cancelled"] } }, now);
    expect(cancelled.totals).toMatchObject({ count: 1, cancelled: 1, amount: "0" });
    expect(cancelled.rows[0]!.amount).toBe("100");
  });
  it("counts one discounted order and does not add orderDiscount again", async () => {
    const r = await loadDailyItem(prisma, actor, "discount-orders", params, now);
    expect(r.totals).toMatchObject({ count: 1, amount: "30", extra: "50" });
    expect(r.rows[0]!.code).toBe("DH-discount");
  });
  it("splits debt directions and both settlement methods", async () => {
    expect((await loadDailyItem(prisma, actor, "debt", params, now)).totals).toMatchObject({ count: 2, amount: "300", extra: "70" });
    expect((await loadDailyItem(prisma, actor, "settlements", params, now)).totals).toMatchObject({ count: 2, amount: "50", extra: "50" });
  });
  it("loss value uses FIFO consumptions and default excludes write-offs", async () => {
    expect((await loadDailyItem(prisma, actor, "loss", params, now)).totals).toMatchObject({ count: 1, amount: "80" });
    expect((await loadDailyItem(prisma, actor, "loss", { ...params, filters: { type: ["LOSS", "WRITE_OFF"] } }, now)).totals.count).toBe(2);
    expect(await pendingUndeliveredCount(prisma, actor)).toBe(1);
  });
  it("redacts money in DTO and Excel, rejects forbidden categories", async () => {
    const limited = { userId: owner, perms: new Set(["return.manage"]) };
    const r = await loadDailyItem(prisma, limited, "return-order", params, now);
    expect(r.rows[0]!.amount).toBeNull(); expect(r.totals.amount).toBeNull();
    await expect(loadDailyItem(prisma, limited, "payments", params, now)).rejects.toMatchObject({ status: 403 });
    expect(visibleDailyItems({ userId: owner, perms: new Set() })).toEqual([]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await exportDaily(prisma, limited, "return-order", params, now) as unknown as ExcelJS.Buffer);
    expect(wb.worksheets[2]!.getRow(1).values).not.toContain("Giá trị");
    const all = new ExcelJS.Workbook(); await all.xlsx.load(await exportDaily(prisma, limited, null, params, now) as unknown as ExcelJS.Buffer);
    expect(all.worksheets).toHaveLength(6); // metadata + summary + four permitted return categories
    expect(all.getWorksheet("Phiếu chi")).toBeUndefined();
  });
  it("exports complete filtered dataset rather than current pagination; workbook totals match UI", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await exportDaily(prisma, actor, "debt", { ...params, page: 20 }, now) as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[2]!;
    expect(ws.rowCount).toBe(4); // header + both docs + totals
    expect(ws.getCell("E4").value).toBe(300); expect(ws.getCell("F4").value).toBe(70);
    expect(ws.getCell("E4").type).toBe(ExcelJS.ValueType.Number);
  });
  it("rejects invalid custom dates and unknown report keys", async () => {
    expect(() => dailyRange(parseListParams({ timePreset: "custom", timeStart: "2026-10-16", timeEnd: "2026-10-15" }), now)).toThrow("khoảng ngày");
    await expect(loadDailyItem(prisma, actor, "invalid", params, now)).rejects.toMatchObject({ status: 404 });
  });
});
