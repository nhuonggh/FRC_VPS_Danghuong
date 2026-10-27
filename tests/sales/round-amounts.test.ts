import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { deliveryNoteSchema } from "@/server/delivery/schemas";
import { createDeliveryNote } from "@/server/delivery/service";
import { editSaleOrderTx } from "@/server/sales/lifecycle";
import { getOrder, getOrderForEdit } from "@/server/sales/queries";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makeProduct } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const PERMS = ["order.create", "order.edit", "sale_price.view", "order.edit_price", "partner.view_all", "order.view"];
let w: World; let actor: Actor; let customer: { id: number }; let fg: { id: number; baseUnit: string };
let n = 0;
const NOW = new Date("2026-09-15T03:00:00Z");

// 1,5 × 237.600 = 356.400 và 1 × 120.250 = 120.250 → tổng 476.650 → làm tròn tổng lên 477.000
const order = (over: Record<string, unknown> = {}) => saleOrderSchema.parse({
  partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "",
  lines: [
    { productId: fg.id, unit: fg.baseUnit, qty: 1.5, salePrice: 237_600, discountNow: 0, discountAccum: 0, processingTypeId: null },
    { productId: fg.id, unit: fg.baseUnit, qty: 1, salePrice: 120_250, discountNow: 0, discountAccum: 0, processingTypeId: null },
  ], ...over,
});
const total = async (id: number) => (await getOrder(prisma, actor, id)).orderTotal;
const amounts = async (id: number) => (await getOrder(prisma, actor, id)).lines.map((l) => l.lineAmount);
const create = (over: Record<string, unknown> = {}) => createSaleOrderIdempotent(prisma, actor, `r-${++n}`, order(over), NOW);

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(PERMS) };
  customer = await makePartner({ isCustomer: true });
  fg = await makeProduct({ kind: "THANH_PHAM" });
  await engine(w)([fg.id], (ctx) => buy(ctx, fg.id, 100, 10_000, T(0), 1));
});

describe("làm tròn tổng tiền hàng theo đơn (thành tiền dòng không làm tròn)", () => {
  it("mặc định đơn mới: dòng giữ SL × giá, tổng làm tròn lên nghìn đồng", async () => {
    const o = await create();
    expect(await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ roundAmounts: false, roundTotal: true });
    expect(await amounts(o.id)).toEqual(["356400", "120250"]);
    expect(await total(o.id)).toBe("477000");
  });

  it("tắt làm tròn tổng: tổng = Σ thành tiền dòng; phí ship cộng sau, không làm tròn", async () => {
    const off = await create({ roundTotal: false });
    expect(await total(off.id)).toBe("476650");
    const ship = await create({ shippingFee: 15_500 });
    expect(await total(ship.id)).toBe("492500"); // 477.000 + 15.500
  });

  it("đơn cũ làm tròn từng dòng giữ nguyên số; sửa đơn chuyển sang làm tròn tổng", async () => {
    const o = await create({ roundTotal: false });
    await prisma.saleOrder.update({ where: { id: o.id }, data: { roundAmounts: true } });
    expect(await total(o.id)).toBe("478000"); // 357.000 + 121.000
    const d = (await getOrderForEdit(prisma, actor, o.id)).defaults;
    expect(d).toMatchObject({ roundAmounts: false, roundTotal: true });
    await editSaleOrderTx(prisma, actor, o.id, saleOrderSchema.parse(d), NOW);
    expect(await total(o.id)).toBe("477000");
  });

  it("sửa đơn: không gửi cờ thì giữ nguyên, gửi thì đổi", async () => {
    const o = await create({ roundTotal: false });
    const d = (await getOrderForEdit(prisma, actor, o.id)).defaults;
    expect(d.roundTotal).toBe(false);
    const { roundTotal: _drop, ...noFlag } = d;
    await editSaleOrderTx(prisma, actor, o.id, saleOrderSchema.parse(noFlag), NOW);
    expect(await total(o.id)).toBe("476650");
    await editSaleOrderTx(prisma, actor, o.id, saleOrderSchema.parse({ ...d, roundTotal: true }), NOW);
    expect(await total(o.id)).toBe("477000");
  });

  it("giao hàng: công nợ ghi đúng tổng đã làm tròn (phần chênh chia theo giá trị hàng giao)", async () => {
    const o = await create();
    const lines = await prisma.saleOrderLine.findMany({ where: { orderId: o.id }, orderBy: { id: "asc" } });
    await prisma.$transaction((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: lines.map((l) => ({ orderLineId: l.id, qty: Number(l.qty) })) }), NOW));
    const debit = (await prisma.partnerLedger.findMany({ where: { docType: "DELIVERY" } })).reduce((s, r) => s + Number(r.debit), 0);
    expect(debit).toBe(477000);
  });

  it("giao hàng: làm tròn tổng XUỐNG (phần lẻ < 500đ) cũng ghi công nợ đúng tổng đã làm tròn, kể cả giao nhiều lần", async () => {
    // 356.400 + 120.050 = 476.450 → làm tròn tổng xuống 476.000 (chênh −450), không phí ship
    const o = await create({ lines: [
      { productId: fg.id, unit: fg.baseUnit, qty: 1.5, salePrice: 237_600, discountNow: 0, discountAccum: 0, processingTypeId: null },
      { productId: fg.id, unit: fg.baseUnit, qty: 1, salePrice: 120_050, discountNow: 0, discountAccum: 0, processingTypeId: null },
    ] });
    expect(await total(o.id)).toBe("476000");
    const lines = await prisma.saleOrderLine.findMany({ where: { orderId: o.id }, orderBy: { id: "asc" } });
    const deliver = (qtys: number[]) => prisma.$transaction((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: lines.map((l, i) => ({ orderLineId: l.id, qty: qtys[i]! })).filter((l) => l.qty > 0) }), NOW));
    await deliver([1, 0]); await deliver([0.5, 1]);
    const debit = (await prisma.partnerLedger.findMany({ where: { docType: "DELIVERY" } })).reduce((s, r) => s + Number(r.debit), 0);
    expect(debit).toBe(476000);
  });

  it("chiết khấu tối đa theo giá trị dòng: dòng không làm tròn, chỉ đơn cũ (roundAmounts=true) được tính tròn", () => {
    const line = (discountNow: number) => ({ productId: 1, unit: "m", qty: 1.5, salePrice: 237_600, discountNow, discountAccum: 0, processingTypeId: null });
    const base = { partnerId: 1, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "" };
    expect(saleOrderSchema.safeParse({ ...base, roundAmounts: true, lines: [line(356_800)] }).success).toBe(true); // ≤ 357.000
    expect(saleOrderSchema.safeParse({ ...base, lines: [line(356_800)] }).success).toBe(false); // > 356.400
    expect(saleOrderSchema.safeParse({ ...base, lines: [line(356_400)] }).success).toBe(true);
  });
});
