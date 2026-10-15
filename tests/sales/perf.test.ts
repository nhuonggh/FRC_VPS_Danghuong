import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { listDebts, DEBT_FILTER_KEYS } from "@/server/debt/queries";
import { getOrder, listOrders, ORDER_FILTER_KEYS } from "@/server/sales/queries";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePartnerGroup } from "../helpers/factories";
import { newWorld } from "../inventory/helpers";

// Đóng plan 04: 1.300 sản phẩm + 1.000 đơn (3 dòng/đơn) — các danh sách/trang bán hàng ≤ 3 s.
const LIMIT_MS = 3000;
let actor: Actor; let firstOrderId: number;

const timed = async <R,>(fn: () => Promise<R>) => { const t0 = Date.now(); const r = await fn(); return { r, ms: Date.now() - t0 }; };

beforeAll(async () => {
  await resetDb();
  const w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(["order.view", "sale_price.view", "cost.view", "partner.view_all", "debt.view"]) };
  const g = await makePartnerGroup();
  await prisma.product.createMany({ data: Array.from({ length: 1300 }, (_, i) => ({ code: `SPP${i}`, name: `Sản phẩm ${i}`, searchText: `spp${i} san pham ${i}`, kind: "THANH_PHAM" as const, baseUnit: "md" })) });
  const products = await prisma.product.findMany({ where: { code: { startsWith: "SPP" } }, select: { id: true } });
  await prisma.partner.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ code: `KHQ${i}`, name: `Khách ${i}`, searchText: `khq${i} khach ${i}`, groupId: g.id })) });
  const partners = await prisma.partner.findMany({ where: { code: { startsWith: "KHQ" } }, select: { id: true } });
  const at = new Date("2026-09-15T03:00:00Z"), day = new Date("2026-09-20T00:00:00Z");
  await prisma.saleOrder.createMany({
    data: Array.from({ length: 1000 }, (_, i) => ({ periodId: w.periodId, code: `DHQ${String(i).padStart(6, "0")}`, partnerId: partners[i % partners.length]!.id, orderDate: at, expectedDeliveryDate: day, originalDeliveryDate: day, createdBy: w.userId })),
  });
  const orders = await prisma.saleOrder.findMany({ where: { code: { startsWith: "DHQ" } }, select: { id: true }, orderBy: { id: "asc" } });
  firstOrderId = orders[0]!.id;
  await prisma.saleOrderLine.createMany({
    data: orders.flatMap((o, i) => [0, 1, 2].map((k) => ({ orderId: o.id, productId: products[(i * 3 + k) % products.length]!.id, qty: 5, unit: "md", factorUsed: 1, qtyBase: 5, salePrice: 50_000 + k, at }))),
  });
  await prisma.partnerLedger.createMany({ data: orders.map((o, i) => ({ periodId: w.periodId, partnerId: partners[i % partners.length]!.id, debit: 100_000 + i, docType: "DELIVERY", docId: 100000 + i, at, createdBy: w.userId })) });
}, 120_000);

describe("hiệu năng bán hàng (1.300 SP, 1.000 đơn)", () => {
  it("danh sách đơn (trang 1, tìm kiếm, lọc) ≤ 3 s", async () => {
    for (const q of [{}, { q: "khach 17" }, { delivery: "NEW" }, { pending: "1" }]) {
      const { r, ms } = await timed(() => listOrders(prisma, actor, parseListParams({ pageSize: "50", ...q }, ORDER_FILTER_KEYS)));
      if (!("pending" in q)) expect(r.total).toBeGreaterThan(0);
      expect(ms).toBeLessThan(LIMIT_MS);
    }
  });
  it("chi tiết đơn ≤ 3 s", async () => {
    const { r, ms } = await timed(() => getOrder(prisma, actor, firstOrderId));
    expect(r.lines).toHaveLength(3);
    expect(ms).toBeLessThan(LIMIT_MS);
  });
  it("tìm sản phẩm trong 1.300 mã ≤ 3 s", async () => {
    const { r, ms } = await timed(() => prisma.product.findMany({ where: { searchText: { contains: "san pham 12" } }, take: 20 }));
    expect(r.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(LIMIT_MS);
  });
  it("công nợ tổng hợp 200 khách nhiều phát sinh ≤ 3 s", async () => {
    const { r, ms } = await timed(() => listDebts(prisma, actor, parseListParams({}, DEBT_FILTER_KEYS)));
    expect(r.total).toBe(200);
    expect(ms).toBeLessThan(LIMIT_MS);
  });
});
