import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";
import { postCashLedger } from "@/server/cash/ledger";
import { closePeriod } from "@/server/closing/service";
import { postPartnerLedger } from "@/server/debt/ledger";
import { closedPeriodOf } from "@/server/period/doc-period";
import { getPeriodOrThrow, listPeriods, periodCash, periodDebts, periodOrders, periodOverview, periodStock } from "@/server/period/history";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner } from "../helpers/factories";
import { buy, engine, newWorld, sell, T, useNoopCostOwners, type World } from "../inventory/helpers";

useNoopCostOwners();
const ALL = new Set(PERMISSIONS.map((p) => p.code));
const CLOSE_AT = new Date("2026-10-01T03:00:00Z");
let w: World; let actor: Actor; let customer: { id: number }; let cash: { id: number }; let periodB: number;

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: ALL };
  customer = await makePartner({ isCustomer: true, name: "Công ty Tôn Việt" });
  cash = await makeCashAccount({ name: "Quỹ tiền mặt" });
  await engine(w)([w.p.id], async (ctx) => { await buy(ctx, w.p.id, 10, 100, T(0), 1); await buy(ctx, w.p.id, 10, 200, T(1), 2); await sell(ctx, w.p.id, 12, T(10), 1); });
  await prisma.openingDebt.create({ data: { periodId: w.periodId, partnerId: customer.id, amount: 100 } });
  await prisma.openingCash.create({ data: { periodId: w.periodId, cashAccountId: cash.id, amount: 1000 } });
  await prisma.$transaction(async (t: Prisma.TransactionClient) => {
    const base = { periodId: w.periodId, createdBy: w.userId, at: T(30) };
    await postPartnerLedger(t, { ...base, partnerId: customer.id, side: "debit", amount: 900, docType: "DELIVERY", docId: 1 });
    await postPartnerLedger(t, { ...base, partnerId: customer.id, side: "credit", amount: 300, docType: "RECEIPT", docId: 1 });
    await postCashLedger(t, { ...base, cashAccountId: cash.id, side: "in", amount: 300, docType: "RECEIPT", docId: 1 });
  });
  const input = { partnerId: customer.id, orderDate: T(5), expectedDeliveryDate: T(5), originalDeliveryDate: T(5), createdBy: w.userId, periodId: w.periodId };
  await prisma.saleOrder.create({ data: { ...input, code: "DH-1", deliveryStatus: "DELIVERED", lines: { create: [{ productId: w.p.id, qty: 4, unit: "md", factorUsed: 1, qtyBase: 4, salePrice: 1000, discountNow: 100, at: T(5) }] } } });
  await prisma.saleOrder.create({ data: { ...input, code: "DH-2", isCancelled: true, cancelledAt: T(6), cancelledBy: w.userId } });
  periodB = (await closePeriod(prisma, actor, { now: CLOSE_AT })).newPeriod.id;
});

describe("tra cứu kỳ (F2)", () => {
  it("danh sách kỳ: kỳ mới nhất trước, kỳ cũ CLOSED có người kết, đếm chứng từ còn hiệu lực", async () => {
    const rows = await listPeriods(prisma, actor);
    expect(rows.map((r) => [r.id, r.status])).toEqual([[periodB, "OPEN"], [w.periodId, "CLOSED"]]);
    expect(rows[1]!.closedByName).toBeTruthy();
    expect(rows[1]!.counts).toMatchObject({ orders: 1, receipts: 0 }); // đơn hủy không tính
  });

  it("tổng quan: số cuối kỳ A = số đầu kỳ B (tồn, công nợ, quỹ); số cuối kỳ A còn nguyên SAU khi đã kết sổ", async () => {
    const a = await periodOverview(prisma, actor, w.periodId), b = await periodOverview(prisma, actor, periodB);
    expect(a.closing.stock).toMatchObject({ lots: 1, qty: "8", value: "1600.00" }); // 20 nhập − 12 bán: còn 8 md lô 200
    expect(a.opening).toMatchObject({ receivable: "100.00", cash: "1000.00" });
    expect(a.closing).toMatchObject({ receivable: "700.00", cash: "1300.00" });
    expect(a.activity).toMatchObject({ orders: 1, revenue: "3900.00", receipts: 0 }); // 4 × 1.000 − 100
    expect(b.opening).toMatchObject({ stockLots: 1, stockQty: "8", stockValue: "1600.00", receivable: "700.00", cash: "1300.00" });
    expect(b.opening.stockValue).toBe(a.closing.stock.value);
    expect(b.opening.receivable).toBe(a.closing.receivable);
    expect(b.opening.cash).toBe(a.closing.cash);
  });

  it("tồn kho kỳ cũ: đầu kỳ / nhập / xuất / cuối kỳ; tìm không dấu; ẩn giá trị khi thiếu cost.view", async () => {
    const [row] = await periodStock(prisma, actor, w.periodId);
    expect(row).toMatchObject({ code: w.p.code, opening: "0", inQty: "20", outQty: "12", closing: "8", closingValue: "1600.00" });
    const [rowB] = await periodStock(prisma, actor, periodB);
    expect(rowB).toMatchObject({ opening: "8", inQty: "0", outQty: "0", closing: "8" });
    expect(await periodStock(prisma, actor, w.periodId, "khong co ma nay")).toEqual([]);
    const [noCost] = await periodStock(prisma, { userId: w.userId, perms: new Set(["period.view_closed", "stock.view"]) }, w.periodId);
    expect(noCost).not.toHaveProperty("closingValue");
  });

  it("công nợ / quỹ kỳ cũ theo đối tác & tài khoản; phạm vi 'khách của mình' được tôn trọng", async () => {
    const [debt] = await periodDebts(prisma, actor, w.periodId);
    expect(debt).toMatchObject({ opening: "100.00", debit: "900.00", credit: "300.00", closing: "700.00" });
    expect(await periodDebts(prisma, actor, w.periodId, "ton viet")).toHaveLength(1);
    const scoped = { userId: w.userId, perms: new Set(["period.view_closed", "debt.view"]) }; // thiếu partner.view_all, khách không do mình phụ trách
    expect(await periodDebts(prisma, scoped, w.periodId)).toEqual([]);
    const [c] = await periodCash(prisma, actor, w.periodId);
    expect(c).toMatchObject({ name: "Quỹ tiền mặt", opening: "1000.00", amountIn: "300.00", amountOut: "0.00", closing: "1300.00" });
  });

  it("đơn hàng của kỳ: phân trang + tổng tiền chỉ khi có sale_price.view", async () => {
    const out = await periodOrders(prisma, actor, w.periodId, { page: 1, pageSize: 1 });
    expect(out.total).toBe(2);
    expect(out.rows).toHaveLength(1);
    const all = await periodOrders(prisma, actor, w.periodId, { page: 1, pageSize: 10 });
    expect(all.rows.find((r) => r.code === "DH-1")).toMatchObject({ total: "3900.00", status: "DELIVERED" });
    expect(all.rows.find((r) => r.code === "DH-2")!.status).toBe("Đã hủy");
    const noPrice = await periodOrders(prisma, { userId: w.userId, perms: new Set(["period.view_closed", "order.view", "partner.view_all"]) }, w.periodId, { page: 1, pageSize: 10 });
    expect(noPrice.rows[0]).not.toHaveProperty("total");
    expect(await periodOrders(prisma, actor, w.periodId, { q: "dh-1", page: 1, pageSize: 10 })).toMatchObject({ total: 1 });
  });

  it("thiếu period.view_closed → 403; kỳ không tồn tại → 404; tổng quan không lộ số tiền khi thiếu quyền", async () => {
    const none: Actor = { userId: w.userId, perms: new Set(["order.view"]) };
    await expect(listPeriods(prisma, none)).rejects.toMatchObject({ status: 403 });
    await expect(getPeriodOrThrow(prisma, actor, 999_999)).rejects.toMatchObject({ status: 404 });
    const limited = await periodOverview(prisma, { userId: w.userId, perms: new Set(["period.view_closed"]) }, w.periodId);
    expect(limited.opening).not.toHaveProperty("stockValue");
    expect(limited.opening).not.toHaveProperty("receivable");
    expect(limited.closing.stock).not.toHaveProperty("value");
    expect(limited.activity).not.toHaveProperty("revenue");
  });

  it("closedPeriodOf: chứng từ kỳ đã kết sổ → thông tin kỳ; chứng từ kỳ mở / không tồn tại → null", async () => {
    const old = await prisma.saleOrder.findFirstOrThrow({ where: { code: "DH-1" } });
    expect(await closedPeriodOf(prisma, "saleOrder", old.id)).toMatchObject({ id: w.periodId, name: w.period.name });
    const fresh = await prisma.saleOrder.create({ data: { partnerId: customer.id, orderDate: CLOSE_AT, expectedDeliveryDate: CLOSE_AT, originalDeliveryDate: CLOSE_AT, createdBy: w.userId, periodId: periodB, code: "DH-MOI", isDraft: true } });
    expect(await closedPeriodOf(prisma, "saleOrder", fresh.id)).toBeNull();
    expect(await closedPeriodOf(prisma, "purchase", 999_999)).toBeNull();
  });
});
