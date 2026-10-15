import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { salePricing } from "@/server/sales/pricing";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePartnerGroup } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
let w: World; let actor: Actor; let n = 0;

const sell = (partnerId: number, price: number) => createSaleOrderIdempotent(prisma, actor, `g-${++n}`, saleOrderSchema.parse({
  partnerId, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "",
  lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 1, salePrice: price, discountNow: 0, discountAccum: 0, processingTypeId: null }],
}), NOW);

beforeEach(async () => {
  await resetDb();
  w = await newWorld(3);
  actor = { userId: w.userId, perms: new Set(["order.create", "order.edit", "sale_price.view", "order.edit_price", "partner.view_all"]) };
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
});

describe("giá bán gần nhất theo nhóm khách hàng", () => {
  it("khách chưa mua lấy giá của khách CÙNG NHÓM, không lẫn nhóm khác", async () => {
    const tho = await makePartnerGroup("Thợ"), le = await makePartnerGroup("Khách lẻ");
    const a = await makePartner({ isCustomer: true, groupId: tho.id }), b = await makePartner({ isCustomer: true, groupId: tho.id }), c = await makePartner({ isCustomer: true, groupId: le.id });
    await sell(a.id, 20_000);
    await sell(c.id, 35_000); // đơn sau cùng thuộc nhóm khác
    const p = await salePricing(prisma, actor, b.id, w.p.id);
    expect(p).toMatchObject({ lastSalePrice: "20000", lastSalePriceForPartner: false, lastSalePriceSource: "group" });
    expect((await salePricing(prisma, actor, a.id, w.p.id))).toMatchObject({ lastSalePrice: "20000", lastSalePriceForPartner: true, lastSalePriceSource: "partner" });
  });

  it("nhóm chưa ai mua ⇒ không mượn giá nhóm khác", async () => {
    const tho = await makePartnerGroup("Thợ"), le = await makePartnerGroup("Khách lẻ");
    const a = await makePartner({ isCustomer: true, groupId: tho.id }), c = await makePartner({ isCustomer: true, groupId: le.id });
    await sell(a.id, 20_000);
    expect((await salePricing(prisma, actor, c.id, w.p.id))?.lastSalePrice).toBeNull();
  });
});
