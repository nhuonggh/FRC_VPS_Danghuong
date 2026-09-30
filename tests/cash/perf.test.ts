import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { listCashBook, listExpenses, listReviewQueue, listVouchers, EXPENSE_FILTER_KEYS, QUEUE_FILTER_KEYS, VOUCHER_FILTER_KEYS } from "@/server/cash/queries";
import { DISCOUNT_FILTER_KEYS, listDiscountBalances } from "@/server/discount/queries";
import { migrationStatus } from "@/server/opening/migration-status";
import { getTrip, listTrips, listUndelivered, TRIP_FILTER_KEYS, UNDELIVERED_FILTER_KEYS } from "@/server/trips/queries";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartnerGroup } from "../helpers/factories";
import { newWorld } from "../inventory/helpers";

// Đóng plan 05 (D10): 1.300 sản phẩm + 1.000 đơn/phiếu — các danh sách/trang tiền, chuyến, chiết khấu ≤ 3 s.
const LIMIT_MS = 3000;
let actor: Actor; let tripId: number;
const timed = async <R,>(fn: () => Promise<R>) => { const t0 = Date.now(); const r = await fn(); return { r, ms: Date.now() - t0 }; };
const P = (keys: readonly string[], sp: Record<string, string> = {}) => parseListParams(sp, keys);

beforeAll(async () => {
  await resetDb();
  const w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(["receipt.manage", "payment.manage", "expense.manage", "cash.review", "cashbook.view", "debt.view", "trip.manage", "trip.settle", "partner.view_all", "cash.transaction.create", "data.import"]) };
  const g = await makePartnerGroup();
  await prisma.product.createMany({ data: Array.from({ length: 1300 }, (_, i) => ({ code: `SPP${i}`, name: `Sản phẩm ${i}`, searchText: `spp${i}`, kind: "THANH_PHAM" as const, baseUnit: "md" })) });
  await prisma.partner.createMany({ data: Array.from({ length: 300 }, (_, i) => ({ code: `KHP${i}`, name: `Khách ${i}`, searchText: `khp${i} khach ${i}`, groupId: g.id, isCustomer: true })) });
  const partners = await prisma.partner.findMany({ where: { code: { startsWith: "KHP" } }, select: { id: true } });
  const cash = await makeCashAccount({ name: "Tiền mặt" });
  const et = await prisma.expenseType.create({ data: { name: "Điện" } });
  const at = new Date("2026-09-15T03:00:00Z");
  // 1.000 phiếu thu (mỗi khách ~3), 500 phiếu chi, 200 chi phí — kèm dòng sổ quỹ
  await prisma.receipt.createMany({ data: Array.from({ length: 1000 }, (_, i) => ({ code: `PT9${String(i).padStart(5, "0")}`, periodId: w.periodId, partnerId: partners[i % partners.length]!.id, type: "THU_NO" as const, amount: 100_000 + i, cashAccountId: cash.id, at: new Date(at.getTime() + i * 60_000), createdBy: w.userId, reviewStatus: i % 3 === 0 ? ("REVIEWED" as const) : ("PENDING_REVIEW" as const) })) });
  await prisma.payment.createMany({ data: Array.from({ length: 700 }, (_, i) => ({ code: `PC9${String(i).padStart(5, "0")}`, periodId: w.periodId, kind: (i < 200 ? "CHI_PHI" : "KHAC") as "CHI_PHI" | "KHAC", amount: 50_000 + i, cashAccountId: cash.id, at: new Date(at.getTime() + i * 60_000), createdBy: w.userId })) });
  const receipts = await prisma.receipt.findMany({ select: { id: true, amount: true, at: true } }); const payments = await prisma.payment.findMany({ select: { id: true, amount: true, at: true, kind: true } });
  await prisma.cashLedger.createMany({ data: [
    ...receipts.map((r) => ({ periodId: w.periodId, cashAccountId: cash.id, amountIn: r.amount, docType: "RECEIPT", docId: r.id, at: r.at, createdBy: w.userId })),
    ...payments.map((p) => ({ periodId: w.periodId, cashAccountId: cash.id, amountOut: p.amount, docType: "PAYMENT", docId: p.id, at: p.at, createdBy: w.userId })),
  ] });
  await prisma.operatingExpense.createMany({ data: payments.filter((p) => p.kind === "CHI_PHI").map((p) => ({ periodId: w.periodId, expenseTypeId: et.id, paymentId: p.id, createdBy: w.userId })) });
  await prisma.discountLedger.createMany({ data: partners.map((p, i) => ({ periodId: w.periodId, partnerId: p.id, amountIn: 10_000 + i, docType: "SALE", docId: 1, at, createdBy: w.userId })) });
  // 120 chuyến × 8 điểm (đơn cần tồn tại ⇒ 120*8 đơn tối thiểu; dùng 1.000 đơn tối giản)
  const orderCount = 1000;
  await prisma.saleOrder.createMany({ data: Array.from({ length: orderCount }, (_, i) => ({ code: `DH9${String(i).padStart(5, "0")}`, periodId: w.periodId, partnerId: partners[i % partners.length]!.id, orderDate: at, expectedDeliveryDate: at, originalDeliveryDate: at, createdBy: w.userId })) });
  const orders = await prisma.saleOrder.findMany({ select: { id: true } });
  const v = await prisma.vehicle.create({ data: { plate: "51C-PERF" } }); const d = await prisma.driver.create({ data: { name: "Lái Perf" } });
  const trips = await Promise.all(Array.from({ length: 120 }, (_, i) => prisma.trip.create({ data: { code: `CH9${String(i).padStart(5, "0")}`, periodId: w.periodId, tripDate: new Date(at.getTime() + i * 86_400_000), vehicleId: v.id, driverId: d.id, createdBy: w.userId } })));
  tripId = trips[0]!.id;
  await prisma.tripOrder.createMany({ data: orders.slice(0, 960).map((o, i) => ({ tripId: trips[Math.floor(i / 8)]!.id, orderId: o.id, seq: (i % 8) + 1, ...(i % 5 === 0 ? { result: "KHONG_GIAO" as const, resultAt: at } : {}) })) });
}, 180_000);

describe("hiệu năng D1–D5 (1.300 SP · 1.000 đơn/phiếu)", () => {
  it("danh sách phiếu thu/chi, hàng chờ kiểm, chi phí, sổ quỹ ≤ 3 s", async () => {
    const a = await timed(() => listVouchers(prisma, actor, "RECEIPT", P(VOUCHER_FILTER_KEYS)));
    expect(a.r.total).toBe(1000); expect(a.ms).toBeLessThan(LIMIT_MS);
    const b = await timed(() => listVouchers(prisma, actor, "PAYMENT", P(VOUCHER_FILTER_KEYS, { status: "PENDING_REVIEW", q: "PC9" })));
    expect(b.r.total).toBeGreaterThan(0); expect(b.ms).toBeLessThan(LIMIT_MS);
    const c = await timed(() => listReviewQueue(prisma, actor, P(QUEUE_FILTER_KEYS)));
    expect(c.r.total).toBeGreaterThan(0); expect(c.ms).toBeLessThan(LIMIT_MS);
    const d = await timed(() => listExpenses(prisma, actor, P(EXPENSE_FILTER_KEYS)));
    expect(d.r.total).toBe(200); expect(d.ms).toBeLessThan(LIMIT_MS);
    const e = await timed(() => listCashBook(prisma, actor, "CASH", null, P([])));
    expect(e.r.total).toBe(1700); expect(e.r.entries).toHaveLength(20); expect(e.ms).toBeLessThan(LIMIT_MS);
  });
  it("sổ chiết khấu 300 khách, danh sách/ chi tiết chuyến, hàng không giao được, trạng thái chuyển dữ liệu ≤ 3 s", async () => {
    const a = await timed(() => listDiscountBalances(prisma, actor, P(DISCOUNT_FILTER_KEYS)));
    expect(a.r.total).toBe(300); expect(a.ms).toBeLessThan(LIMIT_MS);
    const b = await timed(() => listTrips(prisma, actor, P(TRIP_FILTER_KEYS)));
    expect(b.r.total).toBe(120); expect(b.ms).toBeLessThan(LIMIT_MS);
    const c = await timed(() => getTrip(prisma, actor, tripId));
    expect(c.r.stops).toHaveLength(8); expect(c.ms).toBeLessThan(LIMIT_MS);
    const d = await timed(() => listUndelivered(prisma, actor, P(UNDELIVERED_FILTER_KEYS)));
    expect(d.ms).toBeLessThan(LIMIT_MS);
    const e = await timed(() => migrationStatus(prisma));
    expect(e.r.steps.find((s) => s.key === "products")!.count).toBe(1301); expect(e.ms).toBeLessThan(LIMIT_MS);
  });
});
