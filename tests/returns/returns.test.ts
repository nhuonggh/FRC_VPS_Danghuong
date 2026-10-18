import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { deliveryNoteSchema } from "@/server/delivery/schemas";
import { cancelDeliveryNote, createDeliveryNote } from "@/server/delivery/service";
import { getOnHand, updateLayerCost } from "@/server/inventory";
import { returnByOrderSchema, returnByProductSchema } from "@/server/returns/schemas";
import { cancelReturnTx, createReturnByOrderIdempotent, createReturnByProductIdempotent } from "@/server/returns/service";
import { getOrderForReturn, getReturn, listReturns, searchReturnableOrders } from "@/server/returns/queries";
import { lastPurchasePricePerBase, resolveReturnCostByProduct } from "@/server/returns/pricing";
import { parseListParams } from "@/lib/query-params";
import { cancelSaleOrderTx, editSaleOrderTx } from "@/server/sales/lifecycle";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makePeriod } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
const PERMS = ["return.manage", "order.create", "order.edit", "order.cancel", "sale_price.view", "purchase_price.view", "order.edit_price", "partner.view_all"];
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let actor: Actor; let customer: { id: number }; let supplier: { id: number };
let n = 0;

const balance = async (partnerId: number) => {
  const r = await prisma.partnerLedger.aggregate({ where: { partnerId }, _sum: { debit: true, credit: true } });
  return (r._sum.debit ?? new Prisma.Decimal(0)).minus(r._sum.credit ?? 0).toString();
};
const onHand = async () => (await getOnHand(prisma, w.periodId, w.p.id)).toString();
/** Đơn 4 md × 50.000, chiết khấu trừ ngay 20.000 + tích lũy 40.000 (cho dễ kiểm tỷ lệ), đã GIAO đủ. */
const deliveredOrder = async (deliver = 4) => {
  const input = saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 4, salePrice: 50_000, discountNow: 20_000, discountAccum: 40_000, processingTypeId: null }] });
  const o = await createSaleOrderIdempotent(prisma, actor, `r-${++n}`, input, NOW);
  const line = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: o.id } });
  if (deliver > 0) await tx((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: line.id, qty: deliver }] }), NOW));
  return { ...o, lineId: line.id };
};
const retOrder = (orderId: number, orderLineId: number, qty: number) =>
  createReturnByOrderIdempotent(prisma, actor, `ro-${++n}`, returnByOrderSchema.parse({ orderId, date: "2026-09-15", note: "", lines: [{ orderLineId, qty }] }), NOW);
const retProduct = (mode: "BY_PRODUCT" | "SUPPLIER", partnerId: number, qty: number, unitPrice: number) =>
  createReturnByProductIdempotent(prisma, actor, mode, `rp-${++n}`, returnByProductSchema.parse({ partnerId, date: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty, unitPrice }] }), NOW);

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(PERMS) };
  customer = await makePartner({ isCustomer: true });
  supplier = await makePartner({ isCustomer: false, isSupplier: true });
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
});

describe("trả theo đơn (43)", () => {
  it("trả đơn kỳ cũ vào kỳ mở mới, giữ costRef và giá vốn của dòng bán gốc", async () => {
    const order = await deliveredOrder();
    await prisma.period.update({
      where: { id: w.periodId },
      data: { status: "CLOSED", isOpen: null, closedAt: new Date("2026-10-01T00:00:00Z") },
    });
    const nextPeriod = await makePeriod({ openedAt: new Date("2026-09-01T00:00:00Z") });

    const returned = await retOrder(order.id, order.lineId, 1);
    const header = await prisma.goodsReturn.findUniqueOrThrow({ where: { id: returned.id } });
    const layer = await prisma.costLayer.findFirstOrThrow({ where: { sourceDocType: "RETURN_IN", sourceDocId: returned.id } });
    const saleLine = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: order.lineId } });

    expect(header).toMatchObject({ periodId: nextPeriod.id, orderId: order.id });
    expect(layer).toMatchObject({ periodId: nextPeriod.id, costRefType: "SALE", costRefId: order.lineId });
    expect(layer.unitCost.toString()).toBe("10000");
    expect(saleLine.unitCostFifo.toString()).toBe("10000");
    expect((await getOnHand(prisma, nextPeriod.id, w.p.id)).toString()).toBe("1");
  });

  it("nhập lại kho theo GIÁ VỐN dòng bán gốc; công nợ giảm theo tỷ lệ thành tiền dòng; đảo chiết khấu tích lũy theo tỷ lệ", async () => {
    const o = await deliveredOrder();
    expect(await onHand()).toBe("96");
    expect(await balance(customer.id)).toBe("180000"); // 4×50.000 − 20.000
    const r = await retOrder(o.id, o.lineId, 1);
    expect(r.code).toMatch(/^TH\d{6}$/);
    expect(await onHand()).toBe("97");
    expect(await balance(customer.id)).toBe("135000"); // trả 1/4 của 180.000 = 45.000
    const layer = await prisma.costLayer.findFirstOrThrow({ where: { sourceDocType: "RETURN_IN" } });
    expect(layer.unitCost.toString()).toBe("10000");
    expect(layer).toMatchObject({ costRefType: "SALE", costRefId: o.lineId });
    const disc = await prisma.discountLedger.findMany({ where: { docType: "RETURN", docId: r.id } });
    expect(disc.map((d) => d.amountOut.toString())).toEqual(["10000"]); // 1/4 của 40.000
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "return.create" } });
    expect(JSON.stringify(audit.afterJson)).not.toMatch(/45000|50000|salePrice/);
  });

  it("trả hết ⇒ Σ công nợ và chiết khấu đảo đúng bằng thành tiền/chiết khấu dòng (làm tròn luỹ kế)", async () => {
    const o = await deliveredOrder();
    await retOrder(o.id, o.lineId, 3);
    await retOrder(o.id, o.lineId, 1);
    expect(await balance(customer.id)).toBe("0");
    const d = await prisma.discountLedger.aggregate({ where: { orderLineId: o.lineId }, _sum: { amountIn: true, amountOut: true } });
    expect(d._sum.amountIn!.minus(d._sum.amountOut!).toString()).toBe("0");
  });

  it("D-30: không trả quá SL đã giao (kể cả đã trả trước); đơn chưa giao thì chưa trả được", async () => {
    const o = await deliveredOrder(3);
    await expect(retOrder(o.id, o.lineId, 3.001)).rejects.toMatchObject({ status: 400 });
    await retOrder(o.id, o.lineId, 2);
    await expect(retOrder(o.id, o.lineId, 1.5)).rejects.toMatchObject({ status: 400 });
    const nodeliv = await deliveredOrder(0);
    await expect(retOrder(nodeliv.id, nodeliv.lineId, 1)).rejects.toMatchObject({ status: 400 });
  });

  it("hủy phiếu trả: gỡ kho, công nợ, trả lại chiết khấu (dòng điều chỉnh, không xoá lịch sử); hủy 2 lần bị chặn", async () => {
    const o = await deliveredOrder();
    const r = await retOrder(o.id, o.lineId, 2);
    await cancelReturnTx(prisma, actor, r.id, "Nhập nhầm");
    expect(await onHand()).toBe("96");
    expect(await balance(customer.id)).toBe("180000");
    expect(await prisma.stockLedger.count({ where: { docType: "RETURN_IN" } })).toBe(0);
    const d = await prisma.discountLedger.aggregate({ where: { orderLineId: o.lineId }, _sum: { amountIn: true, amountOut: true } });
    expect(d._sum.amountIn!.minus(d._sum.amountOut!).toString()).toBe("40000");
    await expect(cancelReturnTx(prisma, actor, r.id, "x")).rejects.toMatchObject({ status: 409 });
    await retOrder(o.id, o.lineId, 4); // lượng đã trả hết hiệu lực nên trả lại đủ được
  });

  it("đơn đã có phiếu trả: chặn sửa đơn, hủy đơn, hủy phiếu giao làm thiếu SL đã trả", async () => {
    const o = await deliveredOrder();
    const r = await retOrder(o.id, o.lineId, 1);
    await expect(cancelSaleOrderTx(prisma, actor, o.id, "x")).rejects.toMatchObject({ status: 409 });
    const notes = await prisma.deliveryNote.findMany({ where: { orderId: o.id } });
    await expect(tx((t) => cancelDeliveryNote(t, actor, notes[0]!.id))).rejects.toMatchObject({ code: "HAS_RETURN" });
    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id }, include: { lines: true } });
    const input = saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ id: order.lines[0]!.id, productId: w.p.id, unit: w.p.baseUnit, qty: 5, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: null }] });
    await expect(editSaleOrderTx(prisma, actor, o.id, input, NOW)).rejects.toMatchObject({ code: "HAS_RETURN" });
    await cancelReturnTx(prisma, actor, r.id, "Bỏ");
    await tx((t) => cancelDeliveryNote(t, actor, notes[0]!.id)); // hết phiếu trả ⇒ hủy được
  });

  it("giá vốn lớp trả TỰ ĐỔI theo khi vốn dòng bán gốc đổi (sửa giá lô nhập)", async () => {
    const o = await deliveredOrder();
    const r = await retOrder(o.id, o.lineId, 1);
    await engine(w)([w.p.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 12_000 }));
    const layer = await prisma.costLayer.findFirstOrThrow({ where: { sourceDocType: "RETURN_IN", sourceDocId: r.id } });
    expect(layer.unitCost.toString()).toBe("12000");
    expect((await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: o.lineId } })).unitCostFifo.toString()).toBe("12000");
  });

  it("truy vấn: chọn đơn trả được, dòng còn trả, danh sách + chi tiết ẩn giá khi thiếu quyền", async () => {
    const o = await deliveredOrder();
    const r = await retOrder(o.id, o.lineId, 1);
    expect((await searchReturnableOrders(prisma, actor, "")).map((x) => x.id)).toContain(o.id);
    expect((await searchReturnableOrders(prisma, actor, "", customer.id)).map((x) => x.id)).toContain(o.id);
    expect(await searchReturnableOrders(prisma, actor, "", supplier.id)).toEqual([]);
    expect(await searchReturnableOrders(prisma, { userId: -1, perms: new Set(["return.manage"]) }, "", customer.id)).toEqual([]);
    const info = await getOrderForReturn(prisma, actor, o.id);
    expect(info.lines[0]).toMatchObject({ delivered: "4", returned: "1", remaining: "3", returnable: true });
    const list = await listReturns(prisma, actor, ["BY_ORDER"], parseListParams({}, ["state"]));
    expect(list.rows[0]).toMatchObject({ code: r.code, returnTotal: "45000", orderCode: o.code });
    expect(list.stats).toEqual({ active: 1, cancelled: 0, amount: "45000" });
    const blind: Actor = { userId: w.userId, perms: new Set(["return.manage", "partner.view_all"]) };
    expect("returnTotal" in (await listReturns(prisma, blind, ["BY_ORDER"], parseListParams({}, ["state"]))).rows[0]!).toBe(false);
    expect((await listReturns(prisma, blind, ["BY_ORDER"], parseListParams({}, ["state"]))).stats.amount).toBeUndefined();
    expect(JSON.stringify(await getReturn(prisma, blind, r.id))).not.toMatch(/salePrice|lineAmount|returnTotal/);
    await expect(createReturnByOrderIdempotent(prisma, blind, "k", returnByOrderSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: o.lineId, qty: 1 }] }), NOW)).resolves.toBeTruthy(); // trả theo đơn không cần xem giá
  });

  it("thiếu quyền return.manage bị chặn; retry cùng khoá không trả hai lần", async () => {
    const o = await deliveredOrder();
    const nobody: Actor = { userId: w.userId, perms: new Set(["partner.view_all"]) };
    await expect(createReturnByOrderIdempotent(prisma, nobody, "k1", returnByOrderSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: o.lineId, qty: 1 }] }), NOW)).rejects.toThrow();
    const body = returnByOrderSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: o.lineId, qty: 1 }] });
    const a = await createReturnByOrderIdempotent(prisma, actor, "same", body, NOW);
    const b = await createReturnByOrderIdempotent(prisma, actor, "same", body, NOW);
    expect(b.id).toBe(a.id);
    expect(await prisma.goodsReturn.count()).toBe(1);
  });
});

describe("trả hàng chưa giao về kho (hàng không giao được)", () => {
  const retUndelivered = (orderId: number, orderLineId: number, qty: number) =>
    createReturnByOrderIdempotent(prisma, actor, `ru-${++n}`, returnByOrderSchema.parse({ orderId, date: "2026-09-15", note: "", undelivered: true, lines: [{ orderLineId, qty }] }), NOW);

  it("nhập lại kho, KHÔNG đụng công nợ/chiết khấu; chỉ trả phần chưa giao; chặn giao phần đã trả về kho", async () => {
    const o = await deliveredOrder(1); // đặt 4, giao 1 ⇒ chưa giao 3
    const stock0 = await onHand();
    const debt0 = await balance(customer.id);
    const dto = await getOrderForReturn(prisma, actor, o.id, true);
    expect(dto.undelivered).toBe(true);
    expect(dto.lines[0]).toMatchObject({ ordered: "4", delivered: "1", returned: "0", remaining: "3" });

    await expect(retUndelivered(o.id, o.lineId, 3.001)).rejects.toMatchObject({ status: 400 });
    const r = await retUndelivered(o.id, o.lineId, 2);
    expect(Number(await onHand())).toBe(Number(stock0) + 2);
    expect(await balance(customer.id)).toBe(debt0);
    expect(await prisma.discountLedger.count({ where: { docType: "RETURN", docId: r.id } })).toBe(0);
    expect(await prisma.goodsReturn.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ undelivered: true, totalAmount: new Prisma.Decimal(0) });

    // còn lại 1; trả hàng đã giao không bị ảnh hưởng (vẫn tối đa 1 đã giao)
    expect((await getOrderForReturn(prisma, actor, o.id, true)).lines[0].remaining).toBe("1");
    expect((await getOrderForReturn(prisma, actor, o.id, false)).lines[0]).toMatchObject({ delivered: "1", returned: "0", remaining: "1" });
    await expect(retUndelivered(o.id, o.lineId, 1.5)).rejects.toMatchObject({ status: 400 });
    // phần đã trả về kho không giao được nữa (chỉ còn 1)
    await expect(tx((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: o.lineId, qty: 2 }] }), NOW))).rejects.toMatchObject({ status: 400 });
    await tx((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: o.lineId, qty: 1 }] }), NOW));
  });

  it("hủy phiếu trả hàng chưa giao: gỡ kho, công nợ vẫn nguyên", async () => {
    const o = await deliveredOrder(0);
    const stock0 = await onHand();
    const debt0 = await balance(customer.id);
    const r = await retUndelivered(o.id, o.lineId, 4);
    expect(Number(await onHand())).toBe(Number(stock0) + 4);
    await cancelReturnTx(prisma, actor, r.id, "nhầm");
    expect(await onHand()).toBe(stock0);
    expect(await balance(customer.id)).toBe(debt0);
  });
});

describe("trả theo sản phẩm (45)", () => {
  it("chưa từng bán cho khách ⇒ vốn = giá nhập gần nhất; công nợ giảm theo giá nhập tay", async () => {
    await tx((t) => t.partnerLedger.create({ data: { periodId: w.periodId, partnerId: customer.id, debit: 500_000, docType: "DELIVERY", docId: 999, at: NOW, createdBy: w.userId } }));
    await retProduct("BY_PRODUCT", customer.id, 2, 48_000);
    expect(await onHand()).toBe("102");
    expect(await balance(customer.id)).toBe("404000");
    const layer = await prisma.costLayer.findFirstOrThrow({ where: { sourceDocType: "RETURN_IN" } });
    expect(layer.unitCost.toString()).toBe("10000");
    expect(layer.costRefType).toBeNull();
  });

  it("khấu trừ + hoàn tiền mặt/chuyển khoản: công nợ chỉ giảm (tiền hàng − khấu trừ), phiếu chi HOAN_KHACH ghi nợ lại phần hoàn; hủy phiếu trả hủy luôn phiếu hoàn", async () => {
    const cash = await makeCashAccount({ type: "CASH", name: "Quỹ TM" }), bank = await makeCashAccount({ type: "BANK", name: "NH" });
    const payer: Actor = { userId: w.userId, perms: new Set([...PERMS, "payment.manage", "cash.transaction.create"]) };
    // Khách đã trả đủ trước đó (số dư 0) rồi trả lại 2 × 50.000 = 100.000, khấu trừ 20.000 phí vận chuyển ⇒ nhận lại 80.000 (50.000 mặt + 30.000 CK)
    const r = await createReturnByProductIdempotent(prisma, payer, "BY_PRODUCT", `rf-${++n}`, returnByProductSchema.parse({
      partnerId: customer.id, date: "2026-09-15", note: "", deduction: { amount: 20_000, reason: "Phí vận chuyển" },
      refunds: [{ amount: 50_000, cashAccountId: cash.id }, { amount: 30_000, cashAccountId: bank.id }],
      lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 2, unitPrice: 50_000 }],
    }), NOW);
    const head = await prisma.goodsReturn.findUniqueOrThrow({ where: { id: r.id } });
    expect(head.totalAmount.toString()).toBe("100000"); expect(head.deductionAmount.toString()).toBe("20000"); expect(head.deductionNote).toBe("Phí vận chuyển");
    expect(await balance(customer.id)).toBe("0"); // credit 80.000 (net) rồi debit 80.000 (hoàn)
    expect(await prisma.payment.count({ where: { goodsReturnId: r.id, kind: "HOAN_KHACH", isCancelled: false } })).toBe(2);
    expect((await getReturn(prisma, payer, r.id)).refunds).toHaveLength(2);
    await expect(createReturnByProductIdempotent(prisma, payer, "BY_PRODUCT", `rf-${++n}`, returnByProductSchema.parse({ partnerId: customer.id, date: "2026-09-15", note: "", deduction: { amount: 20_000, reason: "" }, refunds: [{ amount: 90_000, cashAccountId: cash.id }], lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 2, unitPrice: 50_000 }] }), NOW)).rejects.toMatchObject({ status: 400 });
    await expect(createReturnByProductIdempotent(prisma, actor, "BY_PRODUCT", `rf-${++n}`, returnByProductSchema.parse({ partnerId: customer.id, date: "2026-09-15", note: "", refunds: [{ amount: 1, cashAccountId: cash.id }], lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 1, unitPrice: 50_000 }] }), NOW)).rejects.toMatchObject({ status: 403 });
    await cancelReturnTx(prisma, payer, r.id, "nhầm");
    expect(await balance(customer.id)).toBe("0");
    expect(await prisma.payment.count({ where: { goodsReturnId: r.id, isCancelled: false } })).toBe(0);
    expect(await onHand()).toBe("100");
  });

  it("đã bán cho khách ⇒ vốn = vốn lần bán gần nhất của khách", async () => {
    const o = await deliveredOrder();
    const sold = await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: o.lineId } });
    expect((await resolveReturnCostByProduct(prisma, customer.id, w.p.id, w.p.code)).toString()).toBe(sold.unitCostFifo.toString());
  });

  it("không có giá vốn tham chiếu nào ⇒ chặn; thiếu sale_price.view bị chặn", async () => {
    await resetDb();
    w = await newWorld(1);
    actor = { userId: w.userId, perms: new Set(PERMS) };
    customer = await makePartner({ isCustomer: true });
    await expect(retProduct("BY_PRODUCT", customer.id, 1, 1000)).rejects.toMatchObject({ status: 400 });
    await expect(createReturnByProductIdempotent(prisma, { userId: w.userId, perms: new Set(["return.manage"]) }, "BY_PRODUCT", "k", returnByProductSchema.parse({ partnerId: customer.id, date: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 1, unitPrice: 1 }] }), NOW)).rejects.toThrow();
  });

  it("hủy phiếu gỡ kho và công nợ", async () => {
    await tx((t) => t.partnerLedger.create({ data: { periodId: w.periodId, partnerId: customer.id, debit: 500_000, docType: "DELIVERY", docId: 999, at: NOW, createdBy: w.userId } }));
    const r = await retProduct("BY_PRODUCT", customer.id, 2, 48_000);
    await cancelReturnTx(prisma, actor, r.id, "Nhầm");
    expect(await onHand()).toBe("100");
    expect(await balance(customer.id)).toBe("500000");
  });
});

describe("trả nhà cung cấp (47)", () => {
  it("xuất kho FIFO theo lô cũ nhất, công nợ phải trả giảm (debit); mã TN…", async () => {
    await tx((t) => t.partnerLedger.create({ data: { periodId: w.periodId, partnerId: supplier.id, credit: 1_000_000, docType: "PURCHASE", docId: 1, at: NOW, createdBy: w.userId } }));
    const r = await retProduct("SUPPLIER", supplier.id, 30, 9_500);
    expect(r.code).toMatch(/^TN\d{6}$/);
    expect(await onHand()).toBe("70");
    expect(await balance(supplier.id)).toBe("-715000"); // credit 1.000.000 − debit 285.000
    const out = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "RETURN_SUPPLIER" } });
    expect(out.qtyOut.toString()).toBe("30");
    expect(out.unitCostOut.toString()).toBe("10000");
    await cancelReturnTx(prisma, actor, r.id, "Nhầm");
    expect(await onHand()).toBe("100");
    expect(await balance(supplier.id)).toBe("-1000000");
  });

  it("không trả quá tồn; chỉ NCC; cần purchase_price.view", async () => {
    await expect(retProduct("SUPPLIER", supplier.id, 100.001, 9_500)).rejects.toMatchObject({ status: 400 });
    await expect(retProduct("SUPPLIER", customer.id, 1, 9_500)).rejects.toMatchObject({ status: 404 });
    await expect(createReturnByProductIdempotent(prisma, { userId: w.userId, perms: new Set(["return.manage"]) }, "SUPPLIER", "k", returnByProductSchema.parse({ partnerId: supplier.id, date: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 1, unitPrice: 1 }] }), NOW)).rejects.toThrow();
  });

  it("giá nhập gần nhất của NCC làm giá mặc định", async () => {
    const purchase = await prisma.purchase.create({ data: { periodId: w.periodId, code: "PN000001", partnerId: supplier.id, at: NOW, purchaseTotal: 1_000_000, createdBy: w.userId } });
    await prisma.purchaseLine.create({ data: { purchaseId: purchase.id, productId: w.p.id, qty: 100, unit: w.p.baseUnit, factorUsed: 1, qtyBase: 100, purchasePrice: 10_000, purchaseAmount: 1_000_000 } });
    expect((await lastPurchasePricePerBase(prisma, w.p.id, supplier.id))!.perBase.toString()).toBe("10000");
    expect((await lastPurchasePricePerBase(prisma, w.p.id, supplier.id))!.forPartner).toBe(true);
  });
});

describe("trả theo đơn — hoàn tiền khách", () => {
  it("hoàn tiền mặt đúng phần hàng trả: công nợ cân bằng, có phiếu chi HOAN_KHACH; hoàn vượt giá trị hàng ⇒ 400; hàng chưa giao ⇒ 400", async () => {
    const cash = await makeCashAccount({ type: "CASH", name: "Quỹ TM" });
    const payer: Actor = { userId: w.userId, perms: new Set([...PERMS, "payment.manage", "cash.transaction.create"]) };
    const o = await deliveredOrder();
    const before = await balance(customer.id);
    const mk = (refunds: { amount: number; cashAccountId: number }[], qty = 1, extra: object = {}) => createReturnByOrderIdempotent(prisma, payer, `rof-${++n}`, returnByOrderSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: o.lineId, qty }], refunds, ...extra }), NOW);
    await expect(mk([{ amount: 45_001, cashAccountId: cash.id }])).rejects.toMatchObject({ status: 400 }); // trả 1/4 của 180.000 = 45.000
    const r = await mk([{ amount: 45_000, cashAccountId: cash.id }]);
    expect(await prisma.payment.count({ where: { goodsReturnId: r.id, kind: "HOAN_KHACH", isCancelled: false } })).toBe(1);
    expect(await balance(customer.id)).toBe(before); // credit 45.000 (trả hàng) rồi debit 45.000 (hoàn)
    await expect(mk([{ amount: 10, cashAccountId: cash.id }], 1, { undelivered: true })).rejects.toMatchObject({ status: 400 });
  });

  it("không có quyền chi tiền ⇒ từ chối hoàn tiền (403)", async () => {
    const cash = await makeCashAccount({ type: "CASH", name: "Quỹ TM" });
    const o = await deliveredOrder();
    await expect(createReturnByOrderIdempotent(prisma, actor, `rof-${++n}`, returnByOrderSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: o.lineId, qty: 1 }], refunds: [{ amount: 1000, cashAccountId: cash.id }] }), NOW)).rejects.toMatchObject({ status: 403 });
  });
});
