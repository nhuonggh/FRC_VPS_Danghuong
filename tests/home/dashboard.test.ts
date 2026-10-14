import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import { dashRange, pctDelta } from "@/server/home/dashboard/common";
import { DASH_TABS, loadDashboard, visibleDashTabs } from "@/server/home/dashboard";
import type { Dashboard, DashTabKey } from "@/server/home/dashboard/types";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makePeriod, makeProduct, makeUser, makeVehicle } from "../helpers/factories";

const NOW = new Date("2026-09-29T03:00:00Z"); // 10:00 ICT 29/09/2026 → "Tháng này" = tháng 9
const ALL = new Set(PERMISSIONS.map((p) => p.code));
const full = (userId: number): Actor => ({ userId, perms: ALL });
const kpi = (d: Dashboard, key: string) => d.kpis.find((k) => k.key === key);
const widget = (d: Dashboard, key: string) => d.widgets.find((w) => w.key === key);
const load = (actor: Actor, tab: DashTabKey) => loadDashboard(prisma, actor, tab, { preset: "thisMonth" }, NOW);

describe("helpers dashboard", () => {
  it("dashRange: kỳ trước liền kề, cùng độ dài; mặc định Tháng này", () => {
    const r = dashRange(undefined, undefined, NOW);
    expect(r.start.toISOString()).toBe("2026-08-31T17:00:00.000Z"); // 00:00 ICT 01/09
    expect(r.end.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(r.prevEnd.getTime()).toBe(r.start.getTime());
    expect(r.end.getTime() - r.start.getTime()).toBe(r.start.getTime() - r.prevStart.getTime());
  });
  it("pctDelta: kỳ trước = 0 → null (không bịa %)", () => {
    expect(pctDelta(5, 0)).toBeNull();
    expect(pctDelta(150, 100)).toBe(50);
    expect(pctDelta(50, 100)).toBe(-50);
  });
  it("visibleDashTabs: không quyền → không tab; có quyền nào thấy tab đó", () => {
    expect(visibleDashTabs({ userId: 1, perms: new Set() })).toEqual([]);
    expect(visibleDashTabs({ userId: 1, perms: new Set(["order.view", "debt.view"]) }).map((t) => t.key)).toEqual(["sales", "accounting"]);
    expect(visibleDashTabs({ userId: 1, perms: ALL })).toHaveLength(DASH_TABS.length);
  });
});

describe("loader dashboard (DB thật)", () => {
  let owner: number;
  let other: number;
  beforeAll(async () => {
    await resetDb();
    const [user, stranger] = [await makeUser(), await makeUser()];
    owner = user.id; other = stranger.id;
    const period = await makePeriod({ openedAt: new Date("2026-08-01T00:00:00Z") });
    const [customer, supplier] = [await makePartner({ ownerUserId: owner }), await makePartner({ isCustomer: false, isSupplier: true })];
    const [p1, p2] = [await makeProduct({ kind: "HANG", minStock: 10 }), await makeProduct({ kind: "NVL" })];
    const cash = await makeCashAccount();
    const vehicle = await makeVehicle();
    const driver = await prisma.driver.create({ data: { name: "Lái xe A" } });
    const base = { periodId: period.id, createdBy: owner };
    const day = (s: string) => new Date(`${s}T05:00:00Z`);

    // ── Bán hàng: đơn hợp lệ 1.000 (900 + 100), đơn hủy/nháp bị loại, đơn tháng trước 500 (để tính delta)
    const order = (code: string, orderDate: string, price: number, over = {}) =>
      prisma.saleOrder.create({
        data: {
          ...base, code, partnerId: customer.id, orderDate: day(orderDate), expectedDeliveryDate: day(orderDate), originalDeliveryDate: day(orderDate), ...over,
          lines: { create: [{ productId: p1.id, qty: 10, unit: "md", factorUsed: 1, qtyBase: 10, salePrice: price, discountNow: price === 100 ? 100 : 0, at: day(orderDate) }, ...(price === 100 ? [{ productId: p2.id, qty: 2, unit: "md", factorUsed: 1, qtyBase: 2, salePrice: 50, discountNow: 0, at: day(orderDate) }] : [])] },
        },
      });
    const o1 = await order("DH1", "2026-09-10", 100, { deliveryStatus: "DELIVERED" });
    await order("DH2", "2026-09-11", 500, { isCancelled: true });
    await order("DH3", "2026-09-12", 500, { isDraft: true });
    await order("DH4", "2026-08-15", 50);
    await prisma.partnerLedger.create({ data: { ...base, partnerId: customer.id, debit: 900, docType: "DELIVERY", docId: o1.id, at: day("2026-09-10") } });

    // ── Giao hàng: 1 đã giao + 1 chưa đi (trễ) + 1 đang giao
    const trip = (code: string, d: string, status: "SETTLED" | "PLANNED" | "ON_ROAD") =>
      prisma.trip.create({ data: { ...base, code, tripDate: day(d), vehicleId: vehicle.id, driverId: driver.id, status, ...(status === "SETTLED" ? { settledAt: day(d), expectedAmount: 0, diffAmount: 0 } : {}) } });
    const t1 = await trip("CG1", "2026-09-12", "SETTLED");
    await trip("CG2", "2026-09-05", "PLANNED");
    await trip("CG3", "2026-09-28", "ON_ROAD");
    await prisma.tripOrder.create({ data: { tripId: t1.id, orderId: o1.id, seq: 1, result: "GIAO_DU", resultAt: day("2026-09-12") } });

    // ── Nhập hàng: 700 (còn hiệu lực) + 300 (hủy)
    const buy = (code: string, total: number, isCancelled = false) =>
      prisma.purchase.create({
        data: {
          ...base, code, partnerId: supplier.id, at: day("2026-09-03"), purchaseTotal: total, isCancelled,
          lines: { create: [{ productId: p1.id, qty: 7, unit: "md", factorUsed: 1, qtyBase: 7, purchasePrice: total / 7, purchaseAmount: total }] },
        },
      });
    await buy("PN1", 700);
    await buy("PN2", 300, true);

    // ── Kho: lớp tồn 7 md của p1 (định mức 10 → dưới định mức)
    const led = await prisma.stockLedger.create({ data: { ...base, productId: p1.id, docType: "PURCHASE", docId: 1, docLineId: 1, qtyIn: 7, at: day("2026-09-03") } });
    await prisma.costLayer.create({ data: { periodId: period.id, productId: p1.id, sourceDocType: "PURCHASE", sourceDocId: 1, sourceLineId: 1, ledgerId: led.id, qtyIn: 7, qtyRemaining: 7, unitCost: 100, at: day("2026-09-03") } });

    // ── Trả hàng 200
    await prisma.goodsReturn.create({
      data: {
        ...base, code: "TH1", kind: "BY_ORDER", partnerId: customer.id, orderId: o1.id, at: day("2026-09-20"), totalAmount: 200,
        lines: { create: [{ productId: p1.id, qty: 2, unit: "md", factorUsed: 1, qtyBase: 2, unitPrice: 100, amount: 200, at: day("2026-09-20") }] },
      },
    });

    // ── Sản xuất: 1 lệnh 5 sản phẩm, tiêu hao 3 NVL
    await prisma.productionOrder.create({ data: { ...base, code: "SX1", productId: p1.id, qty: 5, at: day("2026-09-08"), materials: { create: [{ materialProductId: p2.id, qty: 3 }] } } });

    // ── Kế toán: thu 400, chi 150; quỹ đầu kỳ 1.000
    await prisma.receipt.create({ data: { ...base, code: "PT1", type: "THU_NO", partnerId: customer.id, amount: 400, cashAccountId: cash.id, at: day("2026-09-11") } });
    await prisma.payment.create({ data: { ...base, code: "PC1", kind: "TRA_NCC", partnerId: supplier.id, amount: 150, cashAccountId: cash.id, at: day("2026-09-12") } });
    await prisma.openingCash.create({ data: { periodId: period.id, cashAccountId: cash.id, amount: 1000 } });
    await prisma.cashLedger.createMany({ data: [
      { ...base, cashAccountId: cash.id, amountIn: 400, docType: "RECEIPT", docId: 1, at: day("2026-09-11") },
      { ...base, cashAccountId: cash.id, amountOut: 150, docType: "PAYMENT", docId: 1, at: day("2026-09-12") },
    ] });
  });

  it("Bán hàng: loại đơn hủy/nháp; doanh thu = qty×giá − chiết khấu; delta; khách mới; công nợ", async () => {
    const d = await load(full(owner), "sales");
    expect(kpi(d, "revenue")!.value).toBe(1000);
    expect(kpi(d, "revenue")!.delta).toBe(100); // tháng trước: 10 × 50 = 500
    expect(kpi(d, "orders")!.value).toBe(1);
    expect(kpi(d, "receivable")!.value).toBe(900);
    const recent = widget(d, "recent");
    expect(recent?.kind === "table" && recent.rows.length).toBe(4); // 4 đơn (kể cả hủy/nháp) trong danh sách "gần đây"
    const monthly = widget(d, "monthly");
    expect(monthly?.kind === "bars" && monthly.bars[0]!.values[8]).toBe(1000); // T9
    expect(monthly?.kind === "bars" && monthly.bars[0]!.values[7]).toBe(500); // T8
  });

  it("Bán hàng: không có sale_price.view → không có số tiền nào; thiếu partner.view_all → chỉ khách của mình", async () => {
    const noPrice = await load({ userId: owner, perms: new Set(["order.view", "partner.view_all"]) }, "sales");
    expect(kpi(noPrice, "revenue")).toBeUndefined();
    expect(kpi(noPrice, "receivable")).toBeUndefined();
    expect(JSON.stringify(noPrice)).not.toContain("₫");
    const stranger = await load({ userId: other, perms: new Set(["order.view", "sale_price.view"]) }, "sales");
    expect(kpi(stranger, "orders")!.value).toBe(0);
    expect(kpi(stranger, "revenue")!.value).toBe(0);
    const mine = await load({ userId: owner, perms: new Set(["order.view", "sale_price.view"]) }, "sales");
    expect(kpi(mine, "orders")!.value).toBe(1);
  });

  it("Giao hàng: đếm theo trạng thái, trễ = chưa đi mà quá ngày", async () => {
    const d = await load(full(owner), "delivery");
    expect(kpi(d, "total")!.value).toBe(3);
    expect(kpi(d, "done")!.value).toBe(1);
    expect(kpi(d, "on-road")!.value).toBe(1);
    expect(kpi(d, "late")!.value).toBe(1);
    const daily = widget(d, "daily");
    expect(daily?.kind === "bars" && daily.labels).toHaveLength(30);
    expect(daily?.kind === "bars" && daily.bars[0]!.values.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("Nhập hàng: bỏ phiếu hủy khỏi tổng; đếm phiếu hủy riêng", async () => {
    const d = await load(full(owner), "purchase");
    expect(kpi(d, "count")!.value).toBe(1);
    expect(kpi(d, "value")!.value).toBe(700);
    expect(kpi(d, "cancelled")!.value).toBe(1);
    expect(kpi(await load({ userId: owner, perms: new Set(["purchase.view"]) }, "purchase"), "value")).toBeUndefined();
  });

  it("Kho: tồn, dưới định mức, giá trị chỉ khi có cost.view", async () => {
    const d = await load(full(owner), "inventory");
    expect(kpi(d, "qty")!.value).toBe(7);
    expect(kpi(d, "value")!.value).toBe(700);
    expect(kpi(d, "below")!.value).toBe(1);
    const noCost = await load({ userId: owner, perms: new Set(["stock.view"]) }, "inventory");
    expect(kpi(noCost, "value")).toBeUndefined();
    expect(JSON.stringify(noCost)).not.toContain("₫");
  });

  it("Trả hàng / Sản xuất", async () => {
    const r = await load(full(owner), "returns");
    expect(kpi(r, "count")!.value).toBe(1);
    expect(kpi(r, "value")!.value).toBe(200);
    const p = await load(full(owner), "production");
    expect(kpi(p, "orders")!.value).toBe(1);
    expect(kpi(p, "qty")!.value).toBe(5);
    expect(kpi(p, "materials")!.value).toBe(1);
  });

  it("Kế toán: thu/chi, số dư quỹ = đầu kỳ + sổ quỹ, công nợ phải thu/trả", async () => {
    const d = await load(full(owner), "accounting");
    expect(kpi(d, "in")!.value).toBe(400);
    expect(kpi(d, "out")!.value).toBe(150);
    expect(kpi(d, "net")!.value).toBe(250);
    expect(kpi(d, "cash")!.value).toBe(1250);
    expect(kpi(d, "receivable")!.value).toBe(900);
    expect(kpi(d, "payable")!.value).toBe(0);
  });
  it.each([
    { section: "bank", kpis: [], widgets: [] },
    { section: "cashflow", kpis: ["in", "out", "net"], widgets: ["monthly", "out-mix", "in-mix", "daily", "review"] },
    { section: "debt", kpis: ["receivable", "payable"], widgets: ["receivable", "payable"] },
    { section: "funds", kpis: ["cash"], widgets: ["accounts"] },
  ])("Kế toán/$section chỉ trả số liệu thuộc nhóm đang chọn", async ({ section, kpis, widgets }) => {
    const d = await loadDashboard(prisma, full(owner), "accounting", { preset: "thisMonth", accountingSection: section }, NOW);
    expect(d.kpis.map((k) => k.key)).toEqual(kpis);
    expect(d.widgets.map((w) => w.key)).toEqual(widgets);
    expect(d.bankReceipts !== undefined).toBe(section === "bank");
  });
});
