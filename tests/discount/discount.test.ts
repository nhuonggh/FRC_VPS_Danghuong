import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { requestAdjustment } from "@/server/cash/adjust";
import { cashBalance } from "@/server/cash/balance";
import { adjustmentRequestSchema } from "@/server/cash/schemas";
import { reviewVoucher } from "@/server/cash/vouchers";
import { discountBalance, partnerBalance } from "@/server/debt/balance";
import { getDebtDetail } from "@/server/debt/queries";
import { DISCOUNT_FILTER_KEYS, getDiscountDetail, listDiscountBalances } from "@/server/discount/queries";
import { cancelSettlementSchema, settleSchema } from "@/server/discount/schemas";
import { cancelSettlement, reconcileSettlement, settleDiscount, settleDiscountIdempotent } from "@/server/discount/settle";
import { cancelSaleOrderTx } from "@/server/sales/lifecycle";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner } from "../helpers/factories";
import { buy, engine, newWorld, T, useNoopCostOwners, type World } from "../inventory/helpers";

useNoopCostOwners();
const NOW = new Date("2026-09-15T03:00:00Z");
const KT = ["discount.settle", "cash.transaction.create", "cash.transaction.edit_pending", "cash.adjust.request", "debt.view", "partner.view_all", "order.create", "order.cancel", "sale_price.view", "order.edit_price"];
const HK = ["discount.reconcile", "debt.view", "partner.view_all", "cash.review"];
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let kt: Actor; let hk: Actor; let customer: { id: number }; let cash: { id: number };
let n = 0;
const P = (sp: Record<string, string> = {}) => parseListParams(sp, DISCOUNT_FILTER_KEYS);
const settle = (over: Record<string, unknown> = {}) => tx((t) => settleDiscount(t, kt, settleSchema.parse({ partnerId: customer.id, method: "CASH", amount: 300_000, cashAccountId: cash.id, date: "2026-09-15", note: "", ...over }), NOW));
const order = async (accum: number, key = `o-${++n}`) => createSaleOrderIdempotent(prisma, kt, key, saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 4, salePrice: 50_000, discountNow: 0, discountAccum: accum, processingTypeId: null, note: "" }] }), NOW);
const dbal = async (id = customer.id) => (await discountBalance(prisma, id)).toString();

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  kt = { userId: w.userId, perms: new Set(KT) };
  hk = { userId: (await prisma.user.create({ data: { username: "hk", passwordHash: "x", fullName: "Kế toán trưởng" } })).id, perms: new Set(HK) };
  customer = await makePartner({ isCustomer: true, name: "Khách Đạt", searchText: "khach dat" }); cash = await makeCashAccount({ name: "Tiền mặt" });
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
  await prisma.openingDiscount.create({ data: { periodId: w.periodId, partnerId: customer.id, amount: 500_000 } });
});

describe("tất toán chiết khấu tích lũy (D-37)", () => {
  it("số dư = đầu kỳ + phát sinh từ đơn − ra", async () => {
    await order(40_000);
    expect(await dbal()).toBe("540000");
    const d = await getDiscountDetail(prisma, kt, customer.id, P());
    expect(d).toMatchObject({ opening: "500000", accrued: "40000", settled: "0", balance: "540000", negative: false });
    expect(d.entries.map((e) => [e.docLabel, e.running])).toEqual([["Đơn hàng", "540000"]]);
  });

  it("CASH: phiếu chi TAT_TOAN_CK (quỹ ra, chờ kiểm) + giảm số dư chiết khấu, KHÔNG đụng công nợ", async () => {
    const s = await settle();
    expect(s.code).toMatch(/^CK\d{6}$/);
    expect(await dbal()).toBe("200000");
    const row = await prisma.discountSettlement.findUniqueOrThrow({ where: { id: s.id }, include: { payment: true } });
    expect([row.method, row.payment?.kind, row.payment?.reviewStatus, String(row.payment?.amount)]).toEqual(["CASH", "TAT_TOAN_CK", "PENDING_REVIEW", "300000"]);
    expect((await cashBalance(prisma, w.periodId, cash.id)).balance.toString()).toBe("-300000");
    expect(await prisma.partnerLedger.count()).toBe(0);
    expect((await prisma.discountLedger.findFirstOrThrow({ where: { docType: "DISCOUNT_SETTLE" } })).settleMethod).toBe("CASH");
    expect(await prisma.auditLog.count({ where: { action: "discount.settle" } })).toBe(1);
  });

  it("OFFSET: giảm công nợ khách (credit) + số dư chiết khấu, không có phiếu chi; không vượt số khách đang nợ", async () => {
    await prisma.openingDebt.create({ data: { periodId: w.periodId, partnerId: customer.id, amount: 200_000 } });
    await expect(settle({ method: "OFFSET", cashAccountId: null, amount: 250_000 })).rejects.toMatchObject({ code: "OFFSET_EXCEEDS_DEBT" });
    const s = await settle({ method: "OFFSET", cashAccountId: null, amount: 150_000 });
    expect((await partnerBalance(prisma, customer.id)).balance.toString()).toBe("50000");
    expect(await dbal()).toBe("350000");
    expect(await prisma.payment.count()).toBe(0);
    const debt = await getDebtDetail(prisma, kt, customer.id, P());
    expect(debt.entries[0]).toMatchObject({ docType: "DISCOUNT_SETTLE", docLabel: "Tất toán chiết khấu", docCode: s.code });
    // khách không nợ ⇒ không trừ nợ được
    const other = await makePartner({ isCustomer: true }); await prisma.openingDiscount.create({ data: { periodId: w.periodId, partnerId: other.id, amount: 100 } });
    await expect(tx((t) => settleDiscount(t, kt, settleSchema.parse({ partnerId: other.id, method: "OFFSET", amount: 50, cashAccountId: null, date: "2026-09-15", note: "" }), NOW))).rejects.toMatchObject({ code: "OFFSET_EXCEEDS_DEBT" });
  });

  it("không tất toán quá số dư; [R] hai lần tất toán đồng thời hết số dư ⇒ chỉ một thắng; bấm 2 lần cùng khoá = 1 phiếu", async () => {
    await expect(settle({ amount: 500_001 })).rejects.toMatchObject({ code: "DISCOUNT_EXCEEDS_BALANCE" });
    const res = await Promise.all([settle({ amount: 400_000 }).then(() => "ok", (e) => e.status), settle({ amount: 400_000 }).then(() => "ok", (e) => e.status)]);
    expect(res.sort()).toEqual([409, "ok"]); expect(await dbal()).toBe("100000");
    const input = settleSchema.parse({ partnerId: customer.id, method: "CASH", amount: 10_000, cashAccountId: cash.id, date: "2026-09-15", note: "" });
    await settleDiscountIdempotent(prisma, kt, "k1", input); await settleDiscountIdempotent(prisma, kt, "k1", input);
    expect(await dbal()).toBe("90000"); expect(await prisma.discountSettlement.count()).toBe(2);
  });

  it("chỉ khách hàng; quyền discount.settle; CASH cần quỹ hợp lệ; schema chặn sai dữ liệu", async () => {
    const ncc = await makePartner({ isCustomer: false, isSupplier: true });
    await expect(settle({ partnerId: ncc.id })).rejects.toMatchObject({ status: 400 });
    await expect(tx((t) => settleDiscount(t, { userId: 1, perms: new Set(["cash.transaction.create"]) }, settleSchema.parse({ partnerId: customer.id, method: "CASH", amount: 1, cashAccountId: cash.id, date: "2026-09-15", note: "" }), NOW))).rejects.toMatchObject({ status: 403 });
    await expect(settle({ cashAccountId: 9999 })).rejects.toMatchObject({ status: 400 });
    expect(settleSchema.safeParse({ partnerId: 1, method: "CASH", amount: 5, cashAccountId: null, date: "2026-09-15", note: "" }).success).toBe(false);
    expect(settleSchema.safeParse({ partnerId: 1, method: "OFFSET", amount: 5, cashAccountId: 3, date: "2026-09-15", note: "" }).success).toBe(false);
    expect(cancelSettlementSchema.safeParse({ reason: " " }).success).toBe(false);
  });
});

describe("hậu kiểm và hủy", () => {
  it("hậu kiểm khoá phiếu (không hủy được); hậu kiểm 2 lần / đồng thời chỉ một lần; cần quyền discount.reconcile", async () => {
    const s = await settle();
    await expect(tx((t) => reconcileSettlement(t, kt, s.id))).rejects.toMatchObject({ status: 403 });
    const res = await Promise.all([tx((t) => reconcileSettlement(t, hk, s.id, NOW)).then(() => "ok", (e) => e.status), tx((t) => reconcileSettlement(t, hk, s.id, NOW)).then(() => "ok", (e) => e.status)]);
    expect(res.sort()).toEqual([409, "ok"]);
    const row = await prisma.discountLedger.findFirstOrThrow({ where: { docType: "DISCOUNT_SETTLE" } });
    expect([row.isReconciled, row.reconciledBy]).toEqual([true, hk.userId]);
    await expect(tx((t) => cancelSettlement(t, kt, s.id, "nhầm", NOW))).rejects.toMatchObject({ code: "SETTLEMENT_RECONCILED" });
    expect(await dbal()).toBe("200000");
  });
  it("hủy chưa hậu kiểm: trả số dư, CASH hủy luôn phiếu chi (quỹ về 0), OFFSET đảo công nợ", async () => {
    await prisma.openingDebt.create({ data: { periodId: w.periodId, partnerId: customer.id, amount: 400_000 } });
    const a = await settle(); const b = await settle({ method: "OFFSET", cashAccountId: null, amount: 100_000 });
    expect(await dbal()).toBe("100000"); expect((await partnerBalance(prisma, customer.id)).balance.toString()).toBe("300000");
    await tx((t) => cancelSettlement(t, kt, a.id, "nhập nhầm", NOW)); await tx((t) => cancelSettlement(t, kt, b.id, "nhập nhầm", NOW));
    expect(await dbal()).toBe("500000"); expect((await partnerBalance(prisma, customer.id)).balance.toString()).toBe("400000");
    expect((await cashBalance(prisma, w.periodId, cash.id)).balance.toString()).toBe("0");
    expect((await prisma.payment.findFirstOrThrow()).isCancelled).toBe(true);
    await expect(tx((t) => cancelSettlement(t, kt, a.id, "x", NOW))).rejects.toMatchObject({ status: 409 });
    await expect(tx((t) => reconcileSettlement(t, hk, a.id))).rejects.toMatchObject({ status: 409 });
  });
  it("CASH đã được thủ quỹ kiểm ⇒ không hủy tất toán trực tiếp; phiếu chi tất toán không điều chỉnh trực tiếp", async () => {
    const s = await settle(); const tq: Actor = { userId: hk.userId, perms: new Set(["cash.review"]) };
    const pid = (await prisma.discountSettlement.findUniqueOrThrow({ where: { id: s.id } })).paymentId!;
    await tx((t) => reviewVoucher(t, tq, "PAYMENT", pid));
    await expect(tx((t) => cancelSettlement(t, kt, s.id, "x", NOW))).rejects.toMatchObject({ code: "VOUCHER_REVIEWED" });
    await expect(tx((t) => requestAdjustment(t, kt, "PAYMENT", pid, adjustmentRequestSchema.parse({ kind: "VOID", reason: "x" })))).rejects.toMatchObject({ status: 409 });
    expect(await dbal()).toBe("200000");
  });
});

describe("số dư âm và sổ", () => {
  it("tất toán hết rồi hủy đơn có chiết khấu ⇒ số dư ÂM, hiện ở danh sách (bộ lọc số dư âm) và chi tiết có cảnh báo", async () => {
    const o = await order(40_000);
    await settle({ amount: 540_000 });
    expect(await dbal()).toBe("0");
    await cancelSaleOrderTx(prisma, kt, o.id, "khách huỷ");
    expect(await dbal()).toBe("-40000");
    const list = await listDiscountBalances(prisma, kt, P());
    expect(list.summary).toMatchObject({ negative: 1 });
    expect(list.rows[0]).toMatchObject({ partnerId: customer.id, balance: "-40000", unreconciled: 1 });
    expect((await listDiscountBalances(prisma, kt, P({ state: "negative" }))).total).toBe(1);
    expect((await listDiscountBalances(prisma, kt, P({ state: "positive" }))).total).toBe(0);
    expect((await getDiscountDetail(prisma, kt, customer.id, P())).negative).toBe(true);
  });
  it("danh sách: bỏ khách số dư 0, tìm theo tên, tổng còn nợ; chi tiết liệt kê phiếu + trạng thái hậu kiểm; chặn thiếu quyền, 404", async () => {
    const other = await makePartner({ isCustomer: true, name: "Trần B", searchText: "tran b" });
    await makePartner({ isCustomer: true }); // số dư 0 ⇒ ẩn
    await prisma.openingDiscount.create({ data: { periodId: w.periodId, partnerId: other.id, amount: 70_000 } });
    const s = await settle({ amount: 100_000 }); await tx((t) => reconcileSettlement(t, hk, s.id, NOW));
    const all = await listDiscountBalances(prisma, kt, P());
    expect(all.rows.map((r) => [r.name, r.balance])).toEqual([["Khách Đạt", "400000"], ["Trần B", "70000"]]);
    expect(all.summary.balance).toBe("470000");
    expect((await listDiscountBalances(prisma, kt, P({ q: "tran" }))).rows).toHaveLength(1);
    const d = await getDiscountDetail(prisma, kt, customer.id, P());
    expect(d.settlements).toHaveLength(1);
    expect(d.settlements[0]).toMatchObject({ code: s.code, isReconciled: true, reconciledByName: "Kế toán trưởng", methodLabel: "Chi tiền", amount: "100000" });
    await expect(listDiscountBalances(prisma, { userId: 1, perms: new Set() }, P())).rejects.toMatchObject({ status: 403 });
    await expect(getDiscountDetail(prisma, kt, 99999, P())).rejects.toMatchObject({ status: 404 });
  });
});

describe("chuyển phần chiết khấu còn lại vào lãi công ty (FORFEIT)", () => {
  it("chi 300k + chuyển lãi 200k cùng giao dịch: hết số dư, 1 phiếu chi, phiếu FORFEIT không đụng quỹ/công nợ; hủy phiếu hoàn lại số dư", async () => {
    const before = await partnerBalance(prisma, customer.id);
    const s = await settle({ amount: 300_000, forfeitAmount: 200_000 });
    expect(s.forfeit).toBeDefined();
    expect(await dbal()).toBe("0");
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.discountSettlement.findUniqueOrThrow({ where: { id: s.forfeit!.id } })).toMatchObject({ method: "FORFEIT", paymentId: null });
    expect(await prisma.discountLedger.count({ where: { docType: "DISCOUNT_SETTLE", docId: s.forfeit!.id, settleMethod: "FORFEIT" } })).toBe(1);
    expect((await partnerBalance(prisma, customer.id)).balance.toString()).toBe(before.balance.toString());
    await tx((t) => cancelSettlement(t, kt, s.forfeit!.id, "nhầm", NOW));
    expect(await dbal()).toBe("200000");
  });

  it("chỉ chuyển lãi (method FORFEIT) một phần; tổng chi + chuyển lãi vượt số dư ⇒ 409; FORFEIT không kèm quỹ", async () => {
    await settle({ method: "FORFEIT", cashAccountId: null, amount: 100_000 });
    expect(await dbal()).toBe("400000");
    expect(await prisma.payment.count()).toBe(0);
    await expect(settle({ amount: 300_000, forfeitAmount: 100_001 })).rejects.toMatchObject({ code: "DISCOUNT_EXCEEDS_BALANCE" });
    expect(settleSchema.safeParse({ partnerId: 1, method: "FORFEIT", amount: 5, cashAccountId: 3, date: "2026-09-15", note: "" }).success).toBe(false);
    expect(settleSchema.safeParse({ partnerId: 1, method: "FORFEIT", amount: 5, cashAccountId: null, forfeitAmount: 1, date: "2026-09-15", note: "" }).success).toBe(false);
  });

  it("phiếu FORFEIT cần hậu kiểm như phiếu khác", async () => {
    const s = await settle({ method: "FORFEIT", cashAccountId: null, amount: 100_000 });
    await tx((t) => reconcileSettlement(t, hk, s.id, NOW));
    await expect(tx((t) => cancelSettlement(t, kt, s.id, "x", NOW))).rejects.toMatchObject({ code: "SETTLEMENT_RECONCILED" });
  });
});
