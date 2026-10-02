import { beforeEach, describe, expect, it } from "vitest";
import { getCloseChecklist } from "@/server/period/close-checklist";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makePeriod, makeProduct, makeUser } from "../helpers/factories";

const NOW = new Date("2026-10-01T03:00:00Z");

beforeEach(resetDb);

describe("getCloseChecklist", () => {
  it("kỳ không có blocker hoặc cảnh báo → các nhóm đều rỗng", async () => {
    const period = await makePeriod({ openedAt: new Date("2026-09-01T00:00:00Z") });
    const result = await getCloseChecklist(prisma);
    expect(result.period).toMatchObject({ id: period.id, name: period.name });
    expect(result).toMatchObject({ blockerCount: 0, warningCount: 0 });
    expect(result.blockers.every((item) => item.count === 0)).toBe(true);
    expect(result.warnings.every((item) => item.count === 0)).toBe(true);
  });

  it("chỉ đếm chứng từ kỳ mở: blocker đúng nhóm, draft/cọc/tất toán là warning", async () => {
    const actor = await makeUser();
    const period = await makePeriod({ openedAt: new Date("2026-09-01T00:00:00Z") });
    const closed = await makePeriod({ status: "CLOSED", isOpen: null, openedAt: new Date("2026-08-01T00:00:00Z"), closedAt: NOW });
    const partner = await makePartner({ isCustomer: true });
    const product = await makeProduct();
    const vehicle = await prisma.vehicle.create({ data: { plate: "51A-246.81" } });
    const driver = await prisma.driver.create({ data: { name: "Đặng Hữu Minh" } });
    const cash = await makeCashAccount();
    const baseOrder = {
      partnerId: partner.id, orderDate: NOW, expectedDeliveryDate: NOW, originalDeliveryDate: NOW, createdBy: actor.id,
    };
    const provisional = await prisma.saleOrder.create({
      data: {
        ...baseOrder, periodId: period.id, code: "DH-CLOSE-001",
        lines: { create: { productId: product.id, qty: 4, unit: product.baseUnit, factorUsed: 1, qtyBase: 4, salePrice: 50_000, at: NOW, isProvisional: true } },
      },
    });
    const draft = await prisma.saleOrder.create({ data: { ...baseOrder, periodId: period.id, code: "DH-CLOSE-002", isDraft: true } });
    const openOrder = await prisma.saleOrder.create({ data: { ...baseOrder, periodId: period.id, code: "DH-CLOSE-003" } });
    const oldDraft = await prisma.saleOrder.create({ data: { ...baseOrder, periodId: closed.id, code: "DH-CLOSE-OLD", isDraft: true } });
    await prisma.receipt.create({ data: { periodId: period.id, code: "PT-CLOSE-001", partnerId: partner.id, orderId: draft.id, type: "COC", amount: 50_000, cashAccountId: cash.id, at: NOW, createdBy: actor.id } });
    await prisma.receipt.create({ data: { periodId: period.id, code: "PT-CLOSE-002", partnerId: partner.id, orderId: openOrder.id, type: "COC", amount: 25_000, cashAccountId: cash.id, at: NOW, createdBy: actor.id } });
    await prisma.receipt.create({ data: { periodId: closed.id, code: "PT-CLOSE-OLD", partnerId: partner.id, orderId: oldDraft.id, type: "COC", amount: 10_000, cashAccountId: cash.id, at: NOW, createdBy: actor.id } });
    await prisma.trip.create({ data: { periodId: period.id, code: "CH-CLOSE-001", tripDate: NOW, vehicleId: vehicle.id, driverId: driver.id, createdBy: actor.id, status: "RETURNED" } });
    await prisma.trip.create({ data: { periodId: closed.id, code: "CH-CLOSE-OLD", tripDate: NOW, vehicleId: vehicle.id, driverId: driver.id, createdBy: actor.id, status: "PLANNED" } });
    await prisma.stocktake.create({ data: { periodId: period.id, code: "KK-CLOSE-001", at: NOW, createdBy: actor.id, status: "DRAFT" } });
    await prisma.stocktake.create({ data: { periodId: closed.id, code: "KK-CLOSE-OLD", at: NOW, createdBy: actor.id, status: "DRAFT" } });
    const settlement = await prisma.discountSettlement.create({ data: { periodId: period.id, code: "CK-CLOSE-001", partnerId: partner.id, method: "OFFSET", amount: 1_000, at: NOW, createdBy: actor.id } });
    await prisma.discountLedger.create({ data: { periodId: period.id, partnerId: partner.id, amountOut: 1_000, settleMethod: "OFFSET", docType: "DISCOUNT_SETTLE", docId: settlement.id, at: NOW, createdBy: actor.id } });

    const result = await getCloseChecklist(prisma);
    const counts = Object.fromEntries([...result.blockers, ...result.warnings].map((item) => [item.key, item.count]));
    expect(result.period.id).toBe(period.id);
    expect(result.blockerCount).toBe(3);
    expect(result.warningCount).toBe(4);
    expect(counts).toMatchObject({
      "provisional-sales": 1, "open-trips": 1, "draft-stocktakes": 1,
      "draft-orders": 1, "unused-deposits": 2, "unreconciled-discounts": 1,
    });
    expect(result.blockers[0]!.items[0]).toMatchObject({ id: provisional.id, href: `/sales/orders/${provisional.id}` });
    expect(result.warnings.find((item) => item.key === "draft-orders")!.items.map((item) => item.code)).not.toContain("DH-CLOSE-OLD");
    expect(result.warnings.find((item) => item.key === "unused-deposits")!.items.map((item) => item.code)).toEqual(["PT-CLOSE-001", "PT-CLOSE-002"]);
  });
});