import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { getProductMovements, getProductPricing } from "@/server/products/activity";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { prisma, resetDb } from "../helpers/db";
import { makePartner } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
let w: World; let actor: Actor;
beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(["purchase_price.view", "sale_price.view", "stock.view", "order.create", "order.edit_price", "partner.view_all"]) };
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
});

describe("tab Giá / Lịch sử giao dịch của sản phẩm", () => {
  it("giá nhập/bán gần nhất theo quyền; chưa có ⇒ null", async () => {
    const before = await getProductPricing(prisma, actor, w.p.id);
    expect(before.lastSale).toBeNull();
    const c = await makePartner({ isCustomer: true });
    const o = await createSaleOrderIdempotent(prisma, actor, "pr-1", saleOrderSchema.parse({ partnerId: c.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 2, salePrice: 55_000, discountNow: 0, discountAccum: 0, processingTypeId: null, note: "" }] }), NOW);
    const p = await getProductPricing(prisma, actor, w.p.id);
    expect(p.lastSale).toMatchObject({ salePrice: "55000", orderCode: o.code });
    expect(p.lastPurchase).toMatchObject({ unitCost: "10000", code: null }); // buy() của helper ghi lớp PURCHASE qua engine, không có dòng phiếu nhập nên chưa có mã
    const none = await getProductPricing(prisma, { userId: w.userId, perms: new Set() }, w.p.id);
    expect(none).toMatchObject({ lastPurchase: null, lastSale: null, canSeePurchase: false, canSeeSale: false });
  });
  it("lịch sử giao dịch: mới nhất trước, có nhãn và liên kết; thiếu stock.view ⇒ null", async () => {
    const c = await makePartner({ isCustomer: true });
    const o = await createSaleOrderIdempotent(prisma, actor, "mv-1", saleOrderSchema.parse({ partnerId: c.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 3, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: null, note: "" }] }), NOW);
    const rows = (await getProductMovements(prisma, actor, w.p.id))!;
    expect(rows[0]).toMatchObject({ docType: "SALE", label: "Bán hàng", href: `/sales/orders/${o.id}`, qtyOut: "3" });
    expect(rows.at(-1)!.qtyIn).toBe("100");
    expect(await getProductMovements(prisma, { userId: w.userId, perms: new Set() }, w.p.id)).toBeNull();
  });
});
