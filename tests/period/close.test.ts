import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";
import { cashBalance } from "@/server/cash/balance";
import { postCashLedger } from "@/server/cash/ledger";
import { partnerBalance, discountBalance } from "@/server/debt/balance";
import { postPartnerLedger } from "@/server/debt/ledger";
import { withInventoryTx } from "@/server/inventory";
import { closePeriod as closeOpenPeriod } from "@/server/closing/service";
import { defaultPeriodName } from "@/server/period/close";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makeProduct } from "../helpers/factories";
import { buy, engine, newWorld, sell, T, useNoopCostOwners, type World } from "../inventory/helpers";

const fail = vi.hoisted(() => ({ on: false }));
vi.mock("@/server/inventory", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/server/inventory")>();
  return { ...m, postOpeningLots: (...a: Parameters<typeof m.postOpeningLots>) => (fail.on ? Promise.reject(new Error("boom giữa chừng")) : m.postOpeningLots(...a)) };
});

useNoopCostOwners();
const ALL = new Set(PERMISSIONS.map((p) => p.code));
const CLOSE_AT = new Date("2026-10-01T03:00:00Z"); // 10:00 ICT 01/10
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let actor: Actor; let customer: { id: number }; let supplier: { id: number }; let cash: { id: number };
let p2: { id: number }; let p3: { id: number };

beforeEach(async () => {
  fail.on = false;
  await resetDb();
  w = await newWorld(3);
  actor = { userId: w.userId, perms: ALL };
  [p2, p3] = [w.products[1]!, w.products[2]!];
  customer = await makePartner({ isCustomer: true });
  supplier = await makePartner({ isCustomer: false, isSupplier: true });
  cash = await makeCashAccount();
});

/** Dữ liệu kỳ A: tồn 3 lô (p1: 5@200 + 4@300 còn lại sau khi bán 15), p2 7@50, p3 hết; công nợ, quỹ, chiết khấu có đầu kỳ + phát sinh. */
async function seedPeriodA() {
  const run = engine(w);
  await run([w.p.id, p2.id], async (ctx) => {
    await buy(ctx, w.p.id, 10, 100, T(0), 1);
    await buy(ctx, w.p.id, 10, 200, T(1), 2);
    await buy(ctx, p2.id, 7, 50, T(2), 3);
    await sell(ctx, w.p.id, 15, T(10), 1); // ăn hết lô 100 + 5 của lô 200
    await buy(ctx, w.p.id, 4, 300, T(20), 4);
  });
  await run([p3.id], async (ctx) => { await buy(ctx, p3.id, 3, 80, T(3), 5); await sell(ctx, p3.id, 3, T(11), 2); }); // p3 về 0
  await prisma.openingDebt.create({ data: { periodId: w.periodId, partnerId: supplier.id, amount: -500 } });
  await prisma.openingCash.create({ data: { periodId: w.periodId, cashAccountId: cash.id, amount: 1000 } });
  await prisma.openingDiscount.create({ data: { periodId: w.periodId, partnerId: customer.id, amount: 200 } });
  await tx(async (t) => {
    const base = { periodId: w.periodId, createdBy: w.userId, at: T(30) };
    await postPartnerLedger(t, { ...base, partnerId: customer.id, side: "debit", amount: 1000, docType: "DELIVERY", docId: 1 });
    await postPartnerLedger(t, { ...base, partnerId: customer.id, side: "credit", amount: 300, docType: "RECEIPT", docId: 1 });
    await postCashLedger(t, { ...base, cashAccountId: cash.id, side: "in", amount: 400, docType: "RECEIPT", docId: 1 });
    await postCashLedger(t, { ...base, cashAccountId: cash.id, side: "out", amount: 150, docType: "PAYMENT", docId: 1 });
    await t.discountLedger.create({ data: { ...base, partnerId: customer.id, amountIn: 50, docType: "SALE", docId: 1 } });
    await t.discountLedger.create({ data: { ...base, partnerId: customer.id, amountOut: 20, settleMethod: "OFFSET", docType: "DISCOUNT_SETTLE", docId: 1 } });
  });
}

const balances = async () => ({
  customer: (await partnerBalance(prisma, customer.id)).balance.toString(),
  supplier: (await partnerBalance(prisma, supplier.id)).balance.toString(),
  cash: (await cashBalance(prisma, (await prisma.period.findFirstOrThrow({ where: { isOpen: true } })).id, cash.id)).balance.toString(),
  discount: (await discountBalance(prisma, customer.id)).toString(),
});
const lots = async (periodId: number) => (await prisma.costLayer.findMany({ where: { periodId, qtyRemaining: { gt: 0 } }, orderBy: [{ productId: "asc" }, { at: "asc" }, { id: "asc" }] })).map((l) => [l.productId, l.qtyRemaining.toString(), l.unitCost.toString()]);

describe("kết sổ — bất biến trước = sau", () => {
  it("tồn từng lô, công nợ từng đối tác, quỹ, chiết khấu: số cuối kỳ cũ = số đầu kỳ mới; kỳ cũ CLOSED, kỳ mới OPEN", async () => {
    await seedPeriodA();
    const before = await balances();
    const lotsBefore = await lots(w.periodId);
    expect(before).toEqual({ customer: "700", supplier: "-500", cash: "1250", discount: "230" });
    expect(lotsBefore).toEqual([[w.p.id, "5", "200"], [w.p.id, "4", "300"], [p2.id, "7", "50"]]);

    const out = await closeOpenPeriod(prisma, actor, { now: CLOSE_AT });

    const [a, b] = await Promise.all([prisma.period.findUniqueOrThrow({ where: { id: w.periodId } }), prisma.period.findUniqueOrThrow({ where: { id: out.newPeriod.id } })]);
    expect([a.status, a.isOpen, a.closedBy]).toEqual(["CLOSED", null, w.userId]);
    expect(a.closedAt).toEqual(CLOSE_AT);
    expect([b.status, b.isOpen, b.name]).toEqual(["OPEN", true, "Kỳ 10/2026"]);
    expect(await balances()).toEqual(before); // báo cáo kỳ mới (đọc kỳ đang mở) ra đúng số cũ
    expect(await lots(b.id)).toEqual(lotsBefore); // GIỮ NGUYÊN từng lô, cùng thứ tự FIFO, không đổi giá vốn
    expect(out.carried).toMatchObject({ stockLots: 3, stockProducts: 2, stockQty: "16", stockValue: "2550.00", debtPartners: 2, cashAccounts: 1, discountPartners: 1 });
    // kỳ cũ không bị đụng: sổ giữ nguyên, báo cáo kỳ cũ vẫn ra số cũ
    expect(await prisma.partnerLedger.count({ where: { periodId: w.periodId } })).toBe(2);
    expect((await cashBalance(prisma, w.periodId, cash.id)).balance.toString()).toBe("1250");
    expect(await prisma.costLayer.count({ where: { periodId: w.periodId, qtyRemaining: { gt: 0 } } })).toBe(3);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "period.close" } });
    expect(audit.entityId).toBe(String(w.periodId));
  });

  it("lô đầu kỳ mới là OPENING có dòng opening_stock + sổ kho (qtyIn), ghi đúng ngày đầu kỳ ICT; mã hết tồn không có lô", async () => {
    await seedPeriodA();
    const out = await closeOpenPeriod(prisma, actor, { now: CLOSE_AT });
    const ledger = await prisma.stockLedger.findMany({ where: { periodId: out.newPeriod.id }, orderBy: { seq: "asc" } });
    expect(ledger.map((l) => [l.docType, l.productId, l.qtyIn.toString(), l.qtyOut.toString()])).toEqual([["OPENING", w.p.id, "5", "0"], ["OPENING", w.p.id, "4", "0"], ["OPENING", p2.id, "7", "0"]]);
    expect(ledger[0]!.at.toISOString()).toBe("2026-09-30T17:00:00.000Z"); // 00:00 ICT 01/10
    expect(await prisma.openingStock.count({ where: { periodId: out.newPeriod.id } })).toBe(3);
    expect(await prisma.costLayer.count({ where: { periodId: out.newPeriod.id, productId: p3.id } })).toBe(0);
  });

  it("FIFO tiếp tục đúng ở kỳ mới: bán 6 ăn 5@200 rồi 1@300; tồn cuối = 3@300", async () => {
    await seedPeriodA();
    const out = await closeOpenPeriod(prisma, actor, { now: CLOSE_AT });
    await withInventoryTx(prisma, { userId: w.userId, products: [w.p.id] }, (ctx) => sell(ctx, w.p.id, 6, new Date("2026-10-01T04:00:00Z"), 99));
    const row = await prisma.stockLedger.findFirstOrThrow({ where: { periodId: out.newPeriod.id, docType: "SALE" } });
    expect(row.unitCostOut.toString()).toBe(D(5 * 200 + 300).div(6).toDecimalPlaces(4).toString());
    expect(await lots(out.newPeriod.id)).toEqual([[w.p.id, "3", "300"], [p2.id, "7", "50"]]);
  });

  it("kết sổ liên tiếp (A→B→C): đầu kỳ C = cuối kỳ B, kỳ A giữ nguyên", async () => {
    await seedPeriodA();
    const first = await closeOpenPeriod(prisma, actor, { now: CLOSE_AT });
    await withInventoryTx(prisma, { userId: w.userId, products: [w.p.id] }, (ctx) => sell(ctx, w.p.id, 6, new Date("2026-10-01T04:00:00Z"), 99));
    await tx(async (t) => postPartnerLedger(t, { periodId: first.newPeriod.id, createdBy: w.userId, at: new Date("2026-10-02T03:00:00Z"), partnerId: customer.id, side: "credit", amount: 700, docType: "RECEIPT", docId: 2 }));
    const second = await closeOpenPeriod(prisma, actor, { now: new Date("2026-11-01T03:00:00Z"), newName: "Kỳ tháng 11" });
    expect(second.newPeriod.name).toBe("Kỳ tháng 11");
    expect(await lots(second.newPeriod.id)).toEqual([[w.p.id, "3", "300"], [p2.id, "7", "50"]]);
    expect(await balances()).toMatchObject({ customer: "0", supplier: "-500", cash: "1250", discount: "230" });
    expect(await prisma.period.count({ where: { isOpen: true } })).toBe(1);
    expect(await lots(w.periodId)).toHaveLength(3);
  });

  it("đơn nháp + báo giá chưa chốt được mang sang kỳ mới; đơn/báo giá đã chốt ở lại kỳ cũ", async () => {
    await seedPeriodA();
    const base = { partnerId: customer.id, orderDate: CLOSE_AT, expectedDeliveryDate: CLOSE_AT, originalDeliveryDate: CLOSE_AT, createdBy: w.userId };
    const draft = await prisma.saleOrder.create({ data: { ...base, periodId: w.periodId, code: "DH-NHAP", isDraft: true } });
    const live = await prisma.saleOrder.create({ data: { ...base, periodId: w.periodId, code: "DH-THUONG", deliveryStatus: "DELIVERED" } });
    const cancelledDraft = await prisma.saleOrder.create({ data: { ...base, periodId: w.periodId, code: "DH-HUY", isDraft: true, isCancelled: true, cancelledAt: CLOSE_AT, cancelledBy: w.userId } });
    const quote = await prisma.quote.create({ data: { periodId: w.periodId, code: "BG-1", partnerId: customer.id, at: CLOSE_AT, status: "SENT", createdBy: w.userId } });
    const done = await prisma.quote.create({ data: { periodId: w.periodId, code: "BG-2", partnerId: customer.id, at: CLOSE_AT, status: "CANCELLED", createdBy: w.userId } });
    const out = await closeOpenPeriod(prisma, actor, { now: CLOSE_AT });
    const periodOf = async (t: "saleOrder" | "quote", id: number) => (await (prisma[t] as unknown as { findUniqueOrThrow: (a: unknown) => Promise<{ periodId: number }> }).findUniqueOrThrow({ where: { id } })).periodId;
    expect(await periodOf("saleOrder", draft.id)).toBe(out.newPeriod.id);
    expect(await periodOf("saleOrder", live.id)).toBe(w.periodId);
    expect(await periodOf("saleOrder", cancelledDraft.id)).toBe(w.periodId);
    expect(await periodOf("quote", quote.id)).toBe(out.newPeriod.id);
    expect(await periodOf("quote", done.id)).toBe(w.periodId);
    expect(out.carried).toMatchObject({ draftOrders: 1, quotes: 1 });
  });
});

describe("kết sổ — chặn và an toàn", () => {
  it("còn mục chặn → từ chối CLOSE_BLOCKED, KHÔNG đổi gì (kỳ vẫn mở, không có kỳ mới, không opening)", async () => {
    await seedPeriodA();
    await prisma.stocktake.create({ data: { periodId: w.periodId, code: "KK-NHAP", at: CLOSE_AT, createdBy: w.userId } });
    await expect(closeOpenPeriod(prisma, actor, { now: CLOSE_AT })).rejects.toMatchObject({ status: 409, code: "CLOSE_BLOCKED" });
    expect((await prisma.period.findUniqueOrThrow({ where: { id: w.periodId } })).status).toBe("OPEN");
    expect(await prisma.period.count()).toBe(1);
    expect(await prisma.openingStock.count({ where: { periodId: { not: w.periodId } } })).toBe(0);
  });

  it("thiếu quyền period.close → 403; tên kỳ rỗng → 400", async () => {
    await expect(closeOpenPeriod(prisma, { userId: w.userId, perms: new Set(["order.view"]) }, { now: CLOSE_AT })).rejects.toMatchObject({ status: 403 });
    await expect(closeOpenPeriod(prisma, actor, { now: CLOSE_AT, newName: "   " })).rejects.toMatchObject({ status: 400, code: "INVALID_PERIOD_NAME" });
    expect(await prisma.period.count()).toBe(1);
  });

  it("hai người bấm cùng lúc → đúng MỘT kỳ mới; bên kia nhận 'đã kết sổ'", async () => {
    await seedPeriodA();
    const results = await Promise.allSettled([closeOpenPeriod(prisma, actor, { now: CLOSE_AT }), closeOpenPeriod(prisma, actor, { now: CLOSE_AT })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, code: "PERIOD_ALREADY_CLOSED" });
    expect(await prisma.period.count()).toBe(2);
    expect(await prisma.period.count({ where: { isOpen: true } })).toBe(1);
    expect(await prisma.openingStock.count()).toBe(3); // không nhân đôi lô
  });

  it("lỗi giữa chừng (ghi lô thất bại) → ROLLBACK toàn bộ: kỳ cũ vẫn mở, không kỳ mới, không opening_* mồ côi, đơn nháp không bị dời", async () => {
    await seedPeriodA();
    const draft = await prisma.saleOrder.create({ data: { partnerId: customer.id, orderDate: CLOSE_AT, expectedDeliveryDate: CLOSE_AT, originalDeliveryDate: CLOSE_AT, createdBy: w.userId, periodId: w.periodId, code: "DH-NHAP", isDraft: true } });
    fail.on = true;
    await expect(closeOpenPeriod(prisma, actor, { now: CLOSE_AT })).rejects.toThrow("boom giữa chừng");
    fail.on = false;
    expect((await prisma.period.findUniqueOrThrow({ where: { id: w.periodId } })).isOpen).toBe(true);
    expect(await prisma.period.count()).toBe(1);
    expect(await prisma.openingStock.count()).toBe(0);
    expect(await prisma.openingDebt.count({ where: { periodId: { not: w.periodId } } })).toBe(0);
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: draft.id } })).periodId).toBe(w.periodId);
    // sau lỗi vẫn kết sổ được bình thường
    await expect(closeOpenPeriod(prisma, actor, { now: CLOSE_AT })).resolves.toBeDefined();
  });

  it("giao dịch kho sau kết sổ vào kỳ cũ bị chặn; vào kỳ mới được", async () => {
    await seedPeriodA();
    const out = await closeOpenPeriod(prisma, actor, { now: CLOSE_AT });
    await expect(engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 1, 1, T(40), 50))).rejects.toMatchObject({ name: "PeriodClosedError" });
    await expect(withInventoryTx(prisma, { userId: w.userId, products: [w.p.id] }, (ctx) => buy(ctx, w.p.id, 1, 1, new Date("2026-10-01T05:00:00Z"), 51))).resolves.toBeDefined();
    expect(await prisma.stockLedger.count({ where: { periodId: out.newPeriod.id, docType: "PURCHASE" } })).toBe(1);
  });

  it("tên kỳ mặc định theo tháng ICT lúc kết sổ", () => {
    expect(defaultPeriodName(new Date("2026-09-30T18:00:00Z"))).toBe("Kỳ 10/2026"); // 01:00 ICT 01/10
    expect(defaultPeriodName(new Date("2026-09-30T16:00:00Z"))).toBe("Kỳ 09/2026"); // 23:00 ICT 30/09
  });
});

describe("kết sổ — hiệu năng (cổng chất lượng: ~1.300 SP, vài chục nghìn dòng)", () => {
  it("1.300 mã × 3 lô + 30.000 dòng sổ công nợ/quỹ: kết sổ < 20 giây, bất biến giữ nguyên", async () => {
    const products = await Promise.all(Array.from({ length: 1300 }, () => makeProduct()));
    const at = new Date("2026-09-10T00:00:00Z");
    // dựng tồn trực tiếp bằng SQL tập hợp (bỏ qua engine chỉ để DỰNG dữ liệu test; kết sổ mới là thứ được đo)
    await prisma.stockLedger.createMany({ data: products.flatMap((p, i) => [0, 1, 2].map((k) => ({ periodId: w.periodId, productId: p.id, docType: "PURCHASE" as const, docId: i * 3 + k + 1, docLineId: i * 3 + k + 1, qtyIn: 10 + k, at: new Date(at.getTime() + k * 60_000), createdBy: w.userId }))) });
    const ledger = await prisma.stockLedger.findMany({ where: { periodId: w.periodId, docType: "PURCHASE" }, orderBy: { id: "asc" }, select: { id: true, productId: true, docId: true, qtyIn: true, at: true } });
    await prisma.costLayer.createMany({ data: ledger.map((l) => ({ periodId: w.periodId, productId: l.productId, sourceDocType: "PURCHASE" as const, sourceDocId: l.docId, sourceLineId: l.docId, ledgerId: l.id, qtyIn: l.qtyIn, qtyRemaining: l.qtyIn, unitCost: 1000 + (l.docId % 7), at: l.at })) });
    const partners = await Promise.all(Array.from({ length: 50 }, () => makePartner()));
    await prisma.partnerLedger.createMany({ data: Array.from({ length: 30_000 }, (_, i) => ({ periodId: w.periodId, partnerId: partners[i % 50]!.id, debit: i % 3 === 0 ? 0 : 10 + (i % 90), credit: i % 3 === 0 ? 5 + (i % 40) : 0, docType: "DELIVERY", docId: i + 1, at, createdBy: w.userId })) });
    const before = await Promise.all(partners.map(async (p) => (await partnerBalance(prisma, p.id)).balance.toString()));
    const lotsBefore = await lots(w.periodId);
    const t0 = Date.now();
    const out = await closeOpenPeriod(prisma, actor, { now: CLOSE_AT });
    const ms = Date.now() - t0;
    expect(out.carried.stockLots).toBe(3900);
    expect(await lots(out.newPeriod.id)).toEqual(lotsBefore);
    expect(await Promise.all(partners.map(async (p) => (await partnerBalance(prisma, p.id)).balance.toString()))).toEqual(before);
    expect(ms, `kết sổ mất ${ms} ms`).toBeLessThan(20_000);
  }, 120_000);
});
