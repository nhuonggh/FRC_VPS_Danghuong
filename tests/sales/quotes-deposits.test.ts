import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { deliveryNoteSchema } from "@/server/delivery/schemas";
import { createDeliveryNote } from "@/server/delivery/service";
import { depositSchema } from "@/server/deposits/schemas";
import { cancelDeposit, createDeposit, createDepositIdempotent, releaseDeposit } from "@/server/deposits/service";
import { quoteSchema } from "@/server/quotes/schemas";
import { convertQuote, createQuote, setQuoteStatus, updateQuote } from "@/server/quotes/service";
import { getQuote, listQuotes } from "@/server/quotes/queries";
import { cancelSaleOrderTx, confirmDraftOrderTx, deleteDraftOrder, editSaleOrderTx } from "@/server/sales/lifecycle";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { parseListParams } from "@/lib/query-params";
import { getOrder } from "@/server/sales/queries";
import { salePricing } from "@/server/sales/pricing";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makeProcessingType } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
const PERMS = ["quote.manage", "order.create", "order.edit", "order.cancel", "order.delete_draft", "deposit.manage", "sale_price.view", "order.edit_price", "partner.view_all"];
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let actor: Actor; let customer: { id: number }; let cash: { id: number };

const qBody = (over: Record<string, unknown> = {}) => quoteSchema.parse({
  partnerId: customer.id, date: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 4, salePrice: 50_000, note: "" }], ...over,
});
const newQuote = () => tx((t) => createQuote(t, actor, qBody(), NOW));
const draftFromQuote = async () => { const q = await newQuote(); const o = await tx((t) => convertQuote(t, actor, q.id, NOW)); return { q, ...o }; };
const balance = async (partnerId: number) => {
  const r = await prisma.partnerLedger.aggregate({ where: { partnerId }, _sum: { debit: true, credit: true } });
  return (r._sum.debit ?? new Prisma.Decimal(0)).minus(r._sum.credit ?? 0).toString();
};
const dep = (orderId: number, amount: number) => tx((t) => createDeposit(t, actor, depositSchema.parse({ orderId, amount, cashAccountId: cash.id, date: "2026-09-15", note: "" }), NOW));
const payStatus = async (id: number) => (await prisma.saleOrder.findUniqueOrThrow({ where: { id } })).paymentStatus;
let n = 0;
const confirmedOrder = async (qty = 4) => {
  const input = saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: null }] });
  const o = await createSaleOrderIdempotent(prisma, actor, `c-${++n}`, input, NOW);
  return { ...o, lineId: (await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: o.id } })).id };
};

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(PERMS) };
  customer = await makePartner({ isCustomer: true });
  cash = await makeCashAccount();
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
});

describe("báo giá (mục 35)", () => {
  it("dòng báo giá lưu kiểu gia công, hiện ở chi tiết và mang sang đơn nháp khi chuyển; kiểu không tồn tại bị từ chối", async () => {
    const type = await makeProcessingType("Tôn xốp");
    const line = { productId: w.p.id, unit: w.p.baseUnit, qty: 4, salePrice: 50_000, note: "", processingTypeId: type.id };
    const q = await tx((t) => createQuote(t, actor, qBody({ lines: [line] }), NOW));
    expect((await getQuote(prisma, actor, q.id)).lines[0]!.processingTypeName).toBe("Tôn xốp");
    const o = await tx((t) => convertQuote(t, actor, q.id, NOW));
    expect((await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: o.orderId } })).processingTypeId).toBe(type.id);
    await expect(tx((t) => createQuote(t, actor, qBody({ lines: [{ ...line, processingTypeId: 999_999 }] }), NOW))).rejects.toMatchObject({ status: 400 });
  });

  it("tạo báo giá KHÔNG đụng kho, KHÔNG công nợ; mã BG…; có audit không lộ giá", async () => {
    const q = await newQuote();
    expect(q.code).toMatch(/^BG\d{6}$/);
    expect(await prisma.stockLedger.count({ where: { docType: "SALE" } })).toBe(0);
    expect(await prisma.partnerLedger.count()).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "quote.create" } });
    expect(JSON.stringify(audit.afterJson)).not.toMatch(/50000|salePrice/);
  });

  it("sửa khi DRAFT/SENT; DRAFT→SENT; huỷ; đã CONVERTED/CANCELLED thì bất biến", async () => {
    const q = await newQuote();
    await tx((t) => updateQuote(t, actor, q.id, qBody({ note: "Đã sửa" }), NOW));
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).note).toBe("Đã sửa");
    await tx((t) => setQuoteStatus(t, actor, q.id, "SENT"));
    await expect(tx((t) => setQuoteStatus(t, actor, q.id, "SENT"))).rejects.toMatchObject({ status: 409 });
    await tx((t) => updateQuote(t, actor, q.id, qBody({ note: "Vẫn sửa được khi đã gửi" }), NOW));
    await tx((t) => setQuoteStatus(t, actor, q.id, "CANCELLED"));
    await expect(tx((t) => updateQuote(t, actor, q.id, qBody(), NOW))).rejects.toMatchObject({ status: 409 });
    await expect(tx((t) => convertQuote(t, actor, q.id, NOW))).rejects.toMatchObject({ status: 409 });
  });

  it("chuyển thành đơn ⇒ ĐƠN NHÁP copy dòng/giá, KHÔNG xuất kho, KHÔNG công nợ; chuyển lần hai bị chặn", async () => {
    const { q, orderId, code } = await draftFromQuote();
    expect(code).toMatch(/^DH\d{6}$/);
    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    expect(order.isDraft).toBe(true);
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ productId: w.p.id, unit: w.p.baseUnit });
    expect(order.lines[0]!.salePrice.toString()).toBe("50000");
    expect(order.lines[0]!.qty.toString()).toBe("4");
    expect(await prisma.stockLedger.count({ where: { docType: "SALE" } })).toBe(0);
    expect(await prisma.partnerLedger.count()).toBe(0);
    expect(await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({ status: "CONVERTED", convertedOrderId: orderId });
    await expect(tx((t) => convertQuote(t, actor, q.id, NOW))).rejects.toMatchObject({ status: 409 });
  });

  it("phạm vi 'khách của mình' và quyền; danh sách/chi tiết ẩn giá khi thiếu sale_price.view", async () => {
    const q = await newQuote();
    const narrow: Actor = { userId: w.userId, perms: new Set(["quote.manage", "sale_price.view"]) };
    await expect(tx((t) => updateQuote(t, narrow, q.id, qBody(), NOW))).rejects.toMatchObject({ status: 404 });
    await expect(tx((t) => createQuote(t, { userId: w.userId, perms: new Set(["quote.manage"]) }, qBody(), NOW))).rejects.toThrow(); // thiếu sale_price.view
    const noPrice: Actor = { userId: w.userId, perms: new Set(["quote.manage", "partner.view_all"]) };
    const list = await listQuotes(prisma, noPrice, parseListParams({}, ["status"]));
    expect("quoteTotal" in list.rows[0]!).toBe(false);
    const d = await getQuote(prisma, noPrice, q.id);
    expect(JSON.stringify(d)).not.toMatch(/salePrice|lineAmount|quoteTotal/);
    expect((await listQuotes(prisma, actor, parseListParams({}, ["status"]))).rows[0]!.quoteTotal).toBe("200000");
  });
});

describe("đơn nháp: xác nhận, sửa, xoá hẳn (34c)", () => {
  it("xác nhận ⇒ xuất kho FIFO ngay, gắn giá vốn, hết cờ nháp; xác nhận lần hai bị chặn", async () => {
    const { orderId } = await draftFromQuote();
    await confirmDraftOrderTx(prisma, actor, orderId, NOW);
    const o = await prisma.saleOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    expect(o.isDraft).toBe(false);
    expect(o.lines[0]!.unitCostFifo.toString()).toBe("10000");
    expect(o.lines[0]!.isProvisional).toBe(false);
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", docId: orderId } })).toBe(1);
    expect(await prisma.saleLineIssue.count({ where: { orderLineId: o.lines[0]!.id } })).toBe(1);
    await expect(confirmDraftOrderTx(prisma, actor, orderId, NOW)).rejects.toMatchObject({ status: 409 });
  });

  it("thiếu tồn khi xác nhận ⇒ đơn treo (không lỗi)", async () => {
    const q = await tx((t) => createQuote(t, actor, qBody({ lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 500, salePrice: 1, note: "" }] }), NOW));
    const { orderId } = await tx((t) => convertQuote(t, actor, q.id, NOW));
    await confirmDraftOrderTx(prisma, actor, orderId, NOW);
    expect((await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId } })).isProvisional).toBe(true);
  });

  it("sửa đơn nháp thay dòng, không đụng kho; đơn nháp không giao, không hủy được; giá nháp không thành 'giá gần nhất'", async () => {
    const { orderId } = await draftFromQuote();
    const line = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId } });
    const body = saleOrderSchema.parse({
      partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-18", note: "sửa nháp",
      lines: [{ id: line.id, productId: w.p.id, unit: w.p.baseUnit, qty: 7, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: null }],
    });
    await editSaleOrderTx(prisma, actor, orderId, body, NOW);
    const after = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId } });
    expect(after.qty.toString()).toBe("7");
    expect(await prisma.stockLedger.count({ where: { docType: "SALE" } })).toBe(0);
    await expect(tx((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId, date: "2026-09-15", note: "", lines: [{ orderLineId: after.id, qty: 1 }] }), NOW))).rejects.toThrow(/đơn nháp/i);
    await expect(cancelSaleOrderTx(prisma, actor, orderId, "x")).rejects.toThrow(/Xóa nháp/);
    const p = await salePricing(prisma, actor, customer.id, w.p.id);
    expect(p?.lastSalePrice).toBeNull(); // giá của đơn nháp không phải giá đã bán
  });

  it("xóa hẳn đơn nháp: báo giá nguồn quay về SENT và chuyển lại được; đơn đã xác nhận không xóa được", async () => {
    const { q, orderId } = await draftFromQuote();
    await tx((t) => deleteDraftOrder(t, actor, orderId));
    expect(await prisma.saleOrder.count({ where: { id: orderId } })).toBe(0);
    expect(await prisma.saleOrderLine.count()).toBe(0);
    expect(await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({ status: "SENT", convertedOrderId: null });
    const again = await tx((t) => convertQuote(t, actor, q.id, NOW));
    await confirmDraftOrderTx(prisma, actor, again.orderId, NOW);
    await expect(tx((t) => deleteDraftOrder(t, actor, again.orderId))).rejects.toThrow(/Chỉ xóa hẳn được đơn nháp/);
    await expect(tx((t) => deleteDraftOrder(t, { userId: w.userId, perms: new Set(["order.edit"]) }, again.orderId))).rejects.toThrow();
  });
});

describe("tiền cọc (mục 36)", () => {
  it("thu cọc ⇒ phiếu COC + credit khách + trạng thái thanh toán theo số tiền (Đã cọc → Đã thanh toán → Dư tiền)", async () => {
    const o = await confirmedOrder(); // phải thu 200.000
    const a = await dep(o.id, 50_000);
    expect(a.code).toMatch(/^PT\d{6}$/);
    expect(await payStatus(o.id)).toBe("DEPOSITED");
    expect(await balance(customer.id)).toBe("-50000"); // khách đang dư 50.000 (ta giữ tiền của khách)
    await dep(o.id, 150_000);
    expect(await payStatus(o.id)).toBe("PAID");
    await dep(o.id, 10_000);
    expect(await payStatus(o.id)).toBe("OVERPAID");
    const d = await getOrder(prisma, actor, o.id, NOW);
    expect(d.depositTotal).toBe("210000");
    expect(d.deposits).toHaveLength(3);
  });

  it("khi giao, cọc tự bù trừ vào công nợ: cọc 80.000 + giao đủ 200.000 ⇒ khách còn nợ 120.000", async () => {
    const o = await confirmedOrder();
    await dep(o.id, 80_000);
    await tx((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: o.lineId, qty: 4 }] }), NOW));
    expect(await balance(customer.id)).toBe("120000");
  });

  it("hủy phiếu cọc đảo công nợ và trả trạng thái; không hủy hai lần", async () => {
    const o = await confirmedOrder();
    const a = await dep(o.id, 50_000);
    await tx((t) => cancelDeposit(t, actor, a.id, NOW));
    expect(await payStatus(o.id)).toBe("UNPAID");
    expect(await balance(customer.id)).toBe("0");
    await expect(tx((t) => cancelDeposit(t, actor, a.id, NOW))).rejects.toMatchObject({ status: 409 });
  });

  it("34b: đơn còn cọc không hủy được; chuyển cọc thành số dư khách rồi hủy được — tiền vẫn nằm ở công nợ khách", async () => {
    const o = await confirmedOrder();
    const a = await dep(o.id, 50_000);
    await expect(cancelSaleOrderTx(prisma, actor, o.id, "x")).rejects.toMatchObject({ status: 409, code: "HAS_DEPOSIT" });
    await tx((t) => releaseDeposit(t, actor, a.id));
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: a.id } })).orderId).toBeNull();
    expect(await payStatus(o.id)).toBe("UNPAID");
    await expect(tx((t) => releaseDeposit(t, actor, a.id))).rejects.toMatchObject({ status: 409 });
    await cancelSaleOrderTx(prisma, actor, o.id, "Khách đổi ý");
    expect(await balance(customer.id)).toBe("-50000"); // khách còn số dư 50.000 để dùng cho đơn sau
  });

  it("cọc cho đơn nháp được; nhưng đơn nháp còn cọc thì không xóa hẳn được", async () => {
    const { orderId } = await draftFromQuote();
    const a = await dep(orderId, 30_000);
    await expect(tx((t) => deleteDraftOrder(t, actor, orderId))).rejects.toMatchObject({ code: "HAS_DEPOSIT" });
    await tx((t) => cancelDeposit(t, actor, a.id, NOW));
    await tx((t) => deleteDraftOrder(t, actor, orderId));
    expect(await prisma.saleOrder.count({ where: { id: orderId } })).toBe(0);
  });

  it("kiểm dữ liệu & quyền: số tiền ≤ 0, quỹ ngừng dùng, đơn đã hủy, thiếu deposit.manage, idempotent", async () => {
    const o = await confirmedOrder();
    expect(depositSchema.safeParse({ orderId: o.id, amount: 0, cashAccountId: cash.id, date: "2026-09-15", note: "" }).success).toBe(false);
    expect(depositSchema.safeParse({ orderId: o.id, amount: 1.234, cashAccountId: cash.id, date: "2026-09-15", note: "" }).success).toBe(false);
    const off = await makeCashAccount(); await prisma.cashAccount.update({ where: { id: off.id }, data: { isActive: false } });
    await expect(tx((t) => createDeposit(t, actor, depositSchema.parse({ orderId: o.id, amount: 1000, cashAccountId: off.id, date: "2026-09-15", note: "" }), NOW))).rejects.toThrow(/không hợp lệ/);
    await expect(tx((t) => createDeposit(t, { userId: w.userId, perms: new Set(["order.view", "partner.view_all"]) }, depositSchema.parse({ orderId: o.id, amount: 1000, cashAccountId: cash.id, date: "2026-09-15", note: "" }), NOW))).rejects.toThrow();
    const input = depositSchema.parse({ orderId: o.id, amount: 1000, cashAccountId: cash.id, date: "2026-09-15", note: "" });
    const [x, y] = await Promise.all([1, 2].map(() => createDepositIdempotent(prisma, actor, "same", input)));
    expect(y).toEqual(x);
    expect(await prisma.receipt.count({ where: { orderId: o.id } })).toBe(1);
    await prisma.saleOrder.update({ where: { id: o.id }, data: { isCancelled: true } });
    await expect(dep(o.id, 1000)).rejects.toThrow(/đã hủy/);
  });
});
