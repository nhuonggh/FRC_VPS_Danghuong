import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { createDeliveryNote } from "@/server/delivery/service";
import { orderPaid } from "@/server/deposits/status";
import { editSaleOrderTx } from "@/server/sales/lifecycle";
import { getOrder, getOrderForEdit } from "@/server/sales/queries";
import { allocateOrderDiscount, createSaleOrderIdempotent, type PlannedLine } from "@/server/sales/service";
import { saleOrderSchema } from "@/server/sales/schemas";
import { prisma, resetDb } from "../helpers/db";
import { makePartner } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
const FULL = ["order.create", "order.edit", "sale_price.view", "order.edit_price", "partner.view_all", "order.view"];
let w: World; let actor: Actor; let customer: { id: number };
let n = 0;

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const L = (qty: number, price: number, extra: Record<string, unknown> = {}) => ({ productId: w.p.id, unit: w.p.baseUnit, qty, salePrice: price, discountNow: 0, discountAccum: 0, processingTypeId: null, ...extra });
const input = (lines: ReturnType<typeof L>[], over: Record<string, unknown> = {}) => saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines, ...over });
const create = (lines: ReturnType<typeof L>[], over: Record<string, unknown> = {}) => createSaleOrderIdempotent(prisma, actor, `k-${++n}`, input(lines, over), NOW);
const balance = async () => {
  const a = await prisma.partnerLedger.aggregate({ where: { partnerId: customer.id }, _sum: { debit: true, credit: true } });
  return Number(a._sum.debit ?? 0) - Number(a._sum.credit ?? 0);
};

beforeEach(async () => {
  await resetDb();
  w = await newWorld(3);
  actor = { userId: w.userId, perms: new Set(FULL) };
  customer = await makePartner({ isCustomer: true });
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 1000, 20_000, T(0), 1));
});

const planned = (qty: number, price: number, dn = 0, da = 0) => ({ input: L(qty, price, { discountNow: dn, discountAccum: da }) }) as unknown as PlannedLine;

describe("allocateOrderDiscount", () => {
  it("chia theo tỷ lệ phần còn lại của dòng, dòng cuối nhận dư — Σ = đúng số nhập", () => {
    const shares = allocateOrderDiscount([planned(1, 100), planned(1, 200), planned(1, 300)], 100);
    expect(shares.map(String)).toEqual(["16.67", "33.33", "50"]);
    expect(shares.reduce((s, x) => s.plus(x), D(0)).toString()).toBe("100");
  });
  it("trừ chiết khấu dòng khỏi phần chia; dòng hết giá trị không nhận; vượt tổng ⇒ 400", () => {
    const shares = allocateOrderDiscount([planned(1, 100, 100), planned(2, 100)], 50);
    expect(shares.map(String)).toEqual(["0", "50"]);
    expect(() => allocateOrderDiscount([planned(1, 100)], 100.01)).toThrowError(/vượt/);
  });
});

describe("phí vận chuyển + chiết khấu cả đơn + ghi chú dòng", () => {
  it("tổng phải thu = hàng − chiết khấu cả đơn + phí; chiết khấu nằm trong discountNow từng dòng; ghi chú lưu", async () => {
    const o = await create([L(10, 1000, { note: "Cắt 2m" }), L(10, 3000)], { shippingFee: 500, orderDiscount: 4000 });
    const lines = await prisma.saleOrderLine.findMany({ where: { orderId: o.id }, orderBy: { id: "asc" } });
    expect(lines.map((l) => Number(l.discountOrder))).toEqual([1000, 3000]); // 4.000 chia 1:3
    expect(lines.map((l) => Number(l.discountNow))).toEqual([1000, 3000]);
    expect(lines[0]!.note).toBe("Cắt 2m");
    const d = await getOrder(prisma, actor, o.id);
    expect(d).toMatchObject({ shippingFee: "500", orderDiscount: "4000", orderTotal: "36500" }); // 10.000 + 30.000 − 4.000 + 500
    expect(d.lines[0]!.note).toBe("Cắt 2m");
  });

  it("chiết khấu cả đơn vượt giá trị hàng ⇒ 400, không tạo đơn", async () => {
    await expect(create([L(1, 1000)], { orderDiscount: 1001 })).rejects.toMatchObject({ status: 400 });
    expect(await prisma.saleOrder.count()).toBe(0);
  });

  it("giao từng phần: công nợ ghi hàng + phí theo tỷ lệ giá trị, Σ các lần giao = tổng phải thu", async () => {
    const o = await create([L(10, 1000), L(10, 3000)], { shippingFee: 400 }); // hàng 40.000 + phí 400
    const lines = await prisma.saleOrderLine.findMany({ where: { orderId: o.id }, orderBy: { id: "asc" } });
    const first = await createDeliveryNote(prisma as never, actor, { orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: lines[1]!.id, qty: 10 }] }, NOW);
    // giao dòng 30.000 (75% giá trị) ⇒ phí 300 ⇒ nợ 30.300
    expect(await balance()).toBe(30_300);
    await createDeliveryNote(prisma as never, actor, { orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: lines[0]!.id, qty: 10 }] }, NOW);
    expect(await balance()).toBe(40_400);
    expect(first.code).toMatch(/^PG/);
  });

  it("thanh toán: trạng thái PAID khi đã thu đủ hàng + phí (không phải chỉ tiền hàng)", async () => {
    const o = await create([L(10, 1000)], { shippingFee: 500 });
    const { createDeposit } = await import("@/server/deposits/service");
    const cash = await (await import("../helpers/factories")).makeCashAccount({ type: "CASH", name: "Quỹ" });
    const full = { ...actor, perms: new Set([...FULL, "deposit.manage"]) };
    await prisma.$transaction((tx) => createDeposit(tx, full, { orderId: o.id, amount: 10_000, cashAccountId: cash.id, date: "2026-09-15", note: "" }, NOW));
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus).toBe("DEPOSITED"); // thiếu 500 phí
    await prisma.$transaction((tx) => createDeposit(tx, full, { orderId: o.id, amount: 500, cashAccountId: cash.id, date: "2026-09-15", note: "" }, NOW));
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus).toBe("PAID");
    expect((await orderPaid(prisma as never, o.id)).toString()).toBe("10500");
  });

  it("sửa đơn: ô chiết khấu dòng dựng lại ĐÚNG phần người dùng nhập (không dính phần phân bổ); đổi/giữ phí; phân bổ lại", async () => {
    const o = await create([L(10, 1000, { discountNow: 200 }), L(10, 3000)], { shippingFee: 100, orderDiscount: 4000 });
    const edit = await getOrderForEdit(prisma, actor, o.id);
    expect(edit.defaults).toMatchObject({ shippingFee: 100, orderDiscount: 4000 });
    expect(edit.defaults.lines.map((l) => l.discountNow)).toEqual([200, 0]);
    // sửa: bỏ chiết khấu cả đơn, tăng phí
    await editSaleOrderTx(prisma, actor, o.id, saleOrderSchema.parse({ ...edit.defaults, lines: edit.defaults.lines, orderDiscount: 0, shippingFee: 250 }), NOW);
    const after = await prisma.saleOrderLine.findMany({ where: { orderId: o.id }, orderBy: { id: "asc" } });
    expect(after.map((l) => Number(l.discountNow))).toEqual([200, 0]);
    expect(after.map((l) => Number(l.discountOrder))).toEqual([0, 0]);
    expect(await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ shippingFee: D(250), orderDiscount: D(0) });
    // không gửi phí/chiết khấu khi sửa ⇒ giữ nguyên
    await editSaleOrderTx(prisma, actor, o.id, saleOrderSchema.parse({ ...edit.defaults, lines: edit.defaults.lines, orderDiscount: undefined, shippingFee: undefined }), NOW);
    expect(Number((await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id } })).shippingFee)).toBe(250);
  });
});
