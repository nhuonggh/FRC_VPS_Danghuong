import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { checkoutSchema, createCheckoutSaleOrderIdempotent, WALK_IN_CODE } from "@/server/sales/checkout";
import { saleOrderSchema } from "@/server/sales/schemas";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makePartnerGroup } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
const FULL = ["order.create", "order.edit", "sale_price.view", "order.edit_price", "deposit.manage"]; // KHÔNG có partner.view_all
let w: World; let actor: Actor; let customer: { id: number }; let cash: { id: number };
let n = 0;

const body = (qty = 5, price = 30_000, over: Record<string, unknown> = {}) => saleOrderSchema.parse({
  partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "",
  lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty, salePrice: price, discountNow: 0, discountAccum: 0, processingTypeId: null }], ...over,
});
const run = (input: ReturnType<typeof body>, checkout: unknown, who: Actor = actor, key = `co-${++n}`) =>
  createCheckoutSaleOrderIdempotent(prisma, who, key, input, checkoutSchema.parse(checkout), NOW);
const counts = async () => ({ orders: await prisma.saleOrder.count(), receipts: await prisma.receipt.count(), deliveries: await prisma.deliveryNote.count(), ledger: await prisma.stockLedger.count({ where: { docType: "SALE" } }) });

beforeEach(async () => {
  await resetDb();
  w = await newWorld(3);
  actor = { userId: w.userId, perms: new Set(FULL) };
  customer = await makePartner({ isCustomer: true, ownerUserId: w.userId });
  cash = await makeCashAccount({ type: "CASH", name: "Quỹ tiền mặt" });
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20_000, T(0), 1));
});

describe("bán tại quầy — thu tiền + giao ngay cùng giao dịch", () => {
  it("đối tác: thu đủ + giao ngay ⇒ đơn đã thanh toán & đã giao, công nợ khách = 0", async () => {
    const o = await run(body(), { pickupNow: true, payment: { amount: 150_000, cashAccountId: cash.id, note: "" } });
    const row = await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(row).toMatchObject({ paymentStatus: "PAID", deliveryStatus: "DELIVERED", isDraft: false });
    expect(await prisma.receipt.count({ where: { orderId: o.id, type: "COC", amount: 150_000 } })).toBe(1);
    expect(await prisma.deliveryNote.count({ where: { orderId: o.id } })).toBe(1);
    const led = await prisma.partnerLedger.aggregate({ where: { partnerId: customer.id }, _sum: { debit: true, credit: true } });
    expect(Number(led._sum.debit)).toBe(150_000);
    expect(Number(led._sum.credit)).toBe(150_000);
    expect(await prisma.cashLedger.count({ where: { cashAccountId: cash.id } })).toBe(1);
  });

  it("đối tác thu thiếu ⇒ còn nợ (DEPOSITED), thu 0 ⇒ chỉ có đơn", async () => {
    const o1 = await run(body(), { payment: { amount: 50_000, cashAccountId: cash.id, note: "" } });
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: o1.id } })).paymentStatus).toBe("DEPOSITED");
    const o2 = await run(body(), { payment: { amount: 0, note: "" } });
    expect(await prisma.receipt.count({ where: { orderId: o2.id } })).toBe(0);
  });

  it("thu vượt tiền phải thu / thiếu quỹ ⇒ từ chối và KHÔNG ghi gì (rollback toàn bộ)", async () => {
    const before = await counts();
    await expect(run(body(), { payment: { amount: 150_001, cashAccountId: cash.id, note: "" } })).rejects.toMatchObject({ status: 400 });
    await expect(run(body(), { payment: { amount: 100, note: "" } })).rejects.toMatchObject({ status: 400 });
    expect(await counts()).toEqual(before);
  });

  it("giao ngay khi thiếu tồn ⇒ 409, không tạo đơn", async () => {
    const before = await counts();
    await expect(run(body(500), { pickupNow: true })).rejects.toMatchObject({ status: 409 });
    expect(await counts()).toEqual(before);
  });

  it("thiếu quyền thu tiền / giao hàng ⇒ 403", async () => {
    const noDeposit: Actor = { userId: actor.userId, perms: new Set(FULL.filter((p) => p !== "deposit.manage")) };
    await expect(run(body(), { payment: { amount: 10, cashAccountId: cash.id, note: "" } }, noDeposit)).rejects.toMatchObject({ status: 403 });
    const noEdit: Actor = { userId: actor.userId, perms: new Set(FULL.filter((p) => p !== "order.edit")) };
    await expect(run(body(), { pickupNow: true }, noEdit)).rejects.toMatchObject({ status: 403 });
  });

  it("retry cùng Idempotency-Key ⇒ một đơn, một phiếu thu, một phiếu giao", async () => {
    const co = { pickupNow: true, payment: { amount: 150_000, cashAccountId: cash.id, note: "" } };
    const a = await run(body(), co, actor, "same");
    const b = await run(body(), co, actor, "same");
    expect(b.id).toBe(a.id);
    expect(await counts()).toMatchObject({ orders: 1, receipts: 1, deliveries: 1 });
  });
});

describe("khách lẻ (KHL)", () => {
  it("tự tạo khách KHL lần đầu, ghi tên/SĐT trên đơn, người bán KHÔNG có partner.view_all vẫn lập được", async () => {
    await makePartnerGroup();
    const o = await run(body(), { walkIn: { name: "Anh Ba", phone: "0909" }, pickupNow: true, payment: { amount: 150_000, cashAccountId: cash.id, note: "" } });
    const kh = await prisma.partner.findUniqueOrThrow({ where: { code: WALK_IN_CODE } });
    expect(kh).toMatchObject({ allowCredit: false, isCustomer: true });
    expect(await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ partnerId: kh.id, walkInName: "Anh Ba", walkInPhone: "0909", paymentStatus: "PAID", deliveryStatus: "DELIVERED" });
    // lần 2 dùng lại đúng khách KHL (không tạo thêm)
    await run(body(), { walkIn: { name: "", phone: "" }, payment: { amount: 150_000, cashAccountId: cash.id, note: "" } });
    expect(await prisma.partner.count({ where: { code: WALK_IN_CODE } })).toBe(1);
  });

  it("khách lẻ thu thiếu hoặc không thu ⇒ 400 và không ghi gì", async () => {
    await makePartnerGroup();
    const before = await counts();
    await expect(run(body(), { walkIn: { name: "", phone: "" }, payment: { amount: 100_000, cashAccountId: cash.id, note: "" } })).rejects.toMatchObject({ status: 400 });
    await expect(run(body(), { walkIn: { name: "", phone: "" } })).rejects.toMatchObject({ status: 400 });
    expect(await counts()).toEqual(before);
  });
});
