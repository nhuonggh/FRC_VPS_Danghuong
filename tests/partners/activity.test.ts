import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { deliveryNoteSchema } from "@/server/delivery/schemas";
import { createDeliveryNote } from "@/server/delivery/service";
import { getPartnerActivity } from "@/server/partners/activity";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { prisma, resetDb } from "../helpers/db";
import { makePartner } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
let w: World; let n = 0;
const FULL = ["order.edit", "order.view", "order.create", "sale_price.view", "order.edit_price", "partner.view_all", "debt.view", "quote.manage", "purchase.view", "purchase_price.view"];
let actor: Actor; let cust: { id: number; isCustomer: boolean; isSupplier: boolean }; let sup: { id: number; isCustomer: boolean; isSupplier: boolean };

const order = (partnerId: number) => createSaleOrderIdempotent(prisma, actor, `act-${++n}`, saleOrderSchema.parse({ partnerId, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 2, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: null, note: "" }] }), NOW);

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(FULL) };
  cust = await makePartner({ isCustomer: true }); sup = await makePartner({ isCustomer: false, isSupplier: true });
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
});

describe("hoạt động của đối tác (tab Công nợ / Lịch sử mua / Báo giá & đơn / Lịch sử nhập)", () => {
  it("khách hàng: đơn giao xong vào 'Lịch sử mua hàng', đơn chưa giao + báo giá vào 'Báo giá & đơn hàng', có công nợ và giá trị", async () => {
    const done = await order(cust.id); const open = await order(cust.id);
    const line = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: done.id } });
    await prisma.$transaction((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: done.id, date: "2026-09-15", note: "", lines: [{ orderLineId: line.id, qty: 2 }] }), NOW));
    await prisma.quote.create({ data: { periodId: w.periodId, code: "BG000001", partnerId: cust.id, at: NOW, createdBy: w.userId } });
    const a = await getPartnerActivity(prisma, actor, cust);
    expect(a.history!.map((r) => [r.code, r.total])).toEqual([[done.code, "100000"]]);
    expect(a.pipeline!.orders.map((r) => r.code)).toEqual([open.code]);
    expect(a.pipeline!.quotes.map((q) => [q.code, q.status])).toEqual([["BG000001", "Nháp"]]);
    expect(a.debt).toMatchObject({ balance: expect.any(String) }); expect(a.debt!.entries.length).toBeGreaterThan(0);
    expect(a.purchases).toBeNull();
  });
  it("thiếu quyền ⇒ khối null; thiếu quyền xem giá ⇒ ẩn giá trị nhưng vẫn liệt kê", async () => {
    const o = await order(cust.id);
    const noPrice = await getPartnerActivity(prisma, { userId: w.userId, perms: new Set(["order.view", "partner.view_all"]) }, cust);
    expect(noPrice.debt).toBeNull(); expect(noPrice.pipeline!.quotes).toEqual([]); expect(noPrice.pipeline!.orders[0]).toMatchObject({ code: o.code, total: null });
    const nothing = await getPartnerActivity(prisma, { userId: w.userId, perms: new Set(["partner.view_all"]) }, cust);
    expect(nothing).toEqual({ debt: null, history: null, pipeline: null, purchases: null });
  });
  it("nhà cung cấp: phiếu nhập còn hiệu lực, không lộ giá khi thiếu purchase_price.view; đơn hàng không áp dụng", async () => {
    await prisma.purchase.create({ data: { periodId: w.periodId, code: "PN000001", partnerId: sup.id, at: NOW, purchaseTotal: 700_000, createdBy: w.userId } });
    await prisma.purchase.create({ data: { periodId: w.periodId, code: "PN000002", partnerId: sup.id, at: NOW, purchaseTotal: 1, isCancelled: true, createdBy: w.userId } });
    const a = await getPartnerActivity(prisma, actor, sup);
    expect(a.purchases!.map((p) => [p.code, p.total])).toEqual([["PN000001", "700000"]]); expect(a.history).toBeNull(); expect(a.pipeline).toBeNull();
    const b = await getPartnerActivity(prisma, { userId: w.userId, perms: new Set(["purchase.view", "partner.view_all"]) }, sup);
    expect(b.purchases![0]!.total).toBeNull();
  });
});
