import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveRolePermissions } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";
import { cashBalance } from "@/server/cash/balance";
import { requestAdjustment, decideAdjustment } from "@/server/cash/adjust";
import { createCashClose, voidCashClose } from "@/server/cash/close";
import { adjustmentRequestSchema, cashCloseSchema, decideAdjustmentSchema, paymentSchema, receiptSchema } from "@/server/cash/schemas";
import { cancelVoucher, createPayment, createReceipt, createReceiptIdempotent, editPayment, editReceipt, returnVoucher, reviewVoucher } from "@/server/cash/vouchers";
import { depositSchema } from "@/server/deposits/schemas";
import { cancelDeposit, createDeposit } from "@/server/deposits/service";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makePeriod } from "../helpers/factories";
import { buy, engine, newWorld, T, useNoopCostOwners, type World } from "../inventory/helpers";

useNoopCostOwners();
const NOW = new Date("2026-09-15T03:00:00Z");
const ACC = ["receipt.manage", "payment.manage", "cash.transaction.create", "cash.transaction.edit_pending", "cash.adjust.request", "deposit.manage", "order.create", "sale_price.view", "partner.view_all", "order.edit_price"];
const TRE = [...ACC, "cash.review", "cash.adjust.approve", "cash.close", "cash.close.reopen"];
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let acc: Actor; let tre: Actor; let customer: { id: number }; let supplier: { id: number }; let cash: { id: number }; let bank: { id: number };

const rBody = (over: Record<string, unknown> = {}) => receiptSchema.parse({ type: "THU_NO", partnerId: customer.id, orderId: null, cashAccountId: cash.id, amount: 1_000_000, date: "2026-09-15", note: "", ...over });
const pBody = (over: Record<string, unknown> = {}) => paymentSchema.parse({ kind: "TRA_NCC", partnerId: supplier.id, cashAccountId: cash.id, amount: 400_000, date: "2026-09-15", note: "", ...over });
const newReceipt = (over: Record<string, unknown> = {}) => tx((t) => createReceipt(t, acc, rBody(over), NOW));
const newPayment = (over: Record<string, unknown> = {}) => tx((t) => createPayment(t, acc, pBody(over), NOW));
const pBal = async (partnerId: number) => { const r = await prisma.partnerLedger.aggregate({ where: { partnerId }, _sum: { debit: true, credit: true } }); return (r._sum.debit ?? new Prisma.Decimal(0)).minus(r._sum.credit ?? 0).toString(); };
const bal = async (id = cash.id) => cashBalance(prisma, w.periodId, id);
const status = async (id: number) => (await prisma.receipt.findUniqueOrThrow({ where: { id } })).reviewStatus;
const errOf = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { status?: number; code?: string; message: string });

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  acc = { userId: w.userId, perms: new Set(ACC) };
  const boss = await prisma.user.create({ data: { username: "thuquy", passwordHash: "x", fullName: "Thủ quỹ" } });
  tre = { userId: boss.id, perms: new Set(TRE) };
  customer = await makePartner({ isCustomer: true }); supplier = await makePartner({ isCustomer: false, isSupplier: true });
  cash = await makeCashAccount({ name: "Tiền mặt" }); bank = await makeCashAccount({ type: "BANK", name: "VCB", bankNo: "0123" });
});

describe("kiến trúc & quyền mặc định", () => {
  it("lưu và sửa người ứng tiền, từ chối người không tồn tại", async () => {
    const payment = await newPayment({ advancedById: acc.userId });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).advancedById).toBe(acc.userId);
    await tx(t => editPayment(t, acc, payment.id, pBody({ advancedById: tre.userId }), NOW));
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).advancedById).toBe(tre.userId);
    await expect(newPayment({ advancedById: 2147483647 })).rejects.toThrow("Người ứng tiền");
  });
  it("chỉ src/server/cash/ledger.ts ghi cash_ledger", () => {
    const hits: string[] = [];
    const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !p.replaceAll("\\", "/").endsWith("src/server/cash/ledger.ts") && /cashLedger\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(readFileSync(p, "utf8"))) hits.push(p); } };
    walk("src");
    expect(hits).toEqual([]);
  });
  it("Kế toán không có cash.review/duyệt/chốt; Thủ quỹ có; cả hai lập được phiếu", () => {
    const ke = resolveRolePermissions("Kế toán"), tq = resolveRolePermissions("Thủ quỹ");
    for (const c of ["cash.review", "cash.adjust.approve", "cash.close", "cash.close.reopen"]) expect(ke.has(c), c).toBe(false);
    for (const c of ["cash.review", "cash.adjust.approve", "cash.close"]) expect(tq.has(c), c).toBe(true);
    expect(tq.has("cash.close.reopen")).toBe(false);
    for (const c of ["cash.transaction.create", "cash.transaction.edit_pending", "cash.adjust.request"]) { expect(ke.has(c)).toBe(true); expect(tq.has(c)).toBe(true); }
  });
});

describe("lập phiếu (D-32)", () => {
  it("phiếu thu: sổ quỹ vào + công nợ khách giảm + chờ kiểm + sự kiện + audit; số dư tách vận hành/đã kiểm/chờ kiểm", async () => {
    await prisma.openingCash.create({ data: { periodId: w.periodId, cashAccountId: cash.id, amount: 5_000_000 } });
    const r = await newReceipt();
    expect(r.code).toMatch(/^PT\d{6}$/);
    expect(await pBal(customer.id)).toBe("-1000000");
    const b = await bal();
    expect([b.opening, b.balance, b.reviewed, b.pending].map(String)).toEqual(["5000000", "6000000", "5000000", "1000000"]);
    expect(await status(r.id)).toBe("PENDING_REVIEW");
    expect((await prisma.cashReviewEvent.findMany({ where: { docType: "RECEIPT", docId: r.id } })).map((e) => e.action)).toEqual(["SUBMIT"]);
    expect(await prisma.auditLog.count({ where: { action: "receipt.create" } })).toBe(1);
  });

  it("phiếu chi: sổ quỹ ra; trả NCC và hoàn khách ghi debit; chi khác không đụng công nợ", async () => {
    await newPayment(); await newPayment({ kind: "HOAN_KHACH", partnerId: customer.id, amount: 100_000 }); await newPayment({ kind: "KHAC", partnerId: null, amount: 50_000 });
    expect(await pBal(supplier.id)).toBe("400000"); expect(await pBal(customer.id)).toBe("100000");
    expect((await bal()).balance.toString()).toBe("-550000");
    expect(await prisma.partnerLedger.count()).toBe(2);
  });

  it("bấm 2 lần cùng Idempotency-Key chỉ tạo 1 phiếu; thiếu quyền bị chặn; loại/đối tác sai bị từ chối", async () => {
    await createReceiptIdempotent(prisma, acc, "k1", rBody()); await createReceiptIdempotent(prisma, acc, "k1", rBody());
    expect(await prisma.receipt.count()).toBe(1); expect(await prisma.cashLedger.count()).toBe(1);
    const noCreate: Actor = { userId: acc.userId, perms: new Set(["receipt.manage"]) };
    expect((await errOf(tx((t) => createReceipt(t, noCreate, rBody(), NOW))))?.status).toBe(403);
    expect((await errOf(tx((t) => createReceipt(t, acc, rBody({ partnerId: supplier.id }), NOW))))?.status).toBe(400); // THU_NO phải là khách
    expect(receiptSchema.safeParse({ ...rBody(), partnerId: null }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...pBody(), kind: "KHAC" }).success).toBe(false);
    expect((await errOf(tx((t) => createReceipt(t, acc, rBody({ cashAccountId: 9999 }), NOW))))?.status).toBe(400);
  });

  it("thu theo đơn: trạng thái thanh toán của đơn theo tổng tiền thu; hủy phiếu trả về Chưa thanh toán", async () => {
    await prisma.product.update({ where: { id: w.p.id }, data: { isActive: true } });
    await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
    const o = await createSaleOrderIdempotent(prisma, acc, "o1", saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 4, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: null, note: "" }] }), NOW);
    const st = async () => (await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus;
    const r = await newReceipt({ orderId: o.id, amount: 100_000 });
    expect(await st()).toBe("DEPOSITED");
    await newReceipt({ orderId: o.id, amount: 100_000 });
    expect(await st()).toBe("PAID");
    await tx((t) => cancelVoucher(t, acc, "RECEIPT", r.id, "nhập nhầm", NOW));
    expect(await st()).toBe("DEPOSITED");
    const other = await makePartner({ isCustomer: true });
    expect((await errOf(tx((t) => createReceipt(t, acc, rBody({ partnerId: other.id, orderId: o.id }), NOW))))?.status).toBe(400);
  });

  it("thu nợ đơn kỳ cũ: phiếu thu và sổ phát sinh thuộc kỳ đang mở", async () => {
    await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
    const order = await createSaleOrderIdempotent(prisma, acc, "old-period-order", saleOrderSchema.parse({
      partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "",
      lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 4, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: null }],
    }), NOW);
    await prisma.period.update({ where: { id: w.periodId }, data: { status: "CLOSED", isOpen: null, closedAt: NOW } });
    const nextPeriod = await makePeriod({ openedAt: new Date("2026-09-15T17:00:00Z") });
    const at = new Date("2026-09-16T03:00:00Z");
    const receipt = await tx((t) => createReceipt(t, acc, rBody({ orderId: order.id, amount: 100_000, date: "2026-09-16" }), at));

    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } })).periodId).toBe(nextPeriod.id);
    expect((await prisma.partnerLedger.findFirstOrThrow({ where: { docType: "RECEIPT", docId: receipt.id } })).periodId).toBe(nextPeriod.id);
    expect((await prisma.cashLedger.findFirstOrThrow({ where: { docType: "RECEIPT", docId: receipt.id } })).periodId).toBe(nextPeriod.id);
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: order.id } })).periodId).toBe(w.periodId);
  });
});

describe("sửa / hủy khi chưa kiểm tra", () => {
  it("sửa phiếu thu gỡ và ghi lại sổ quỹ + công nợ theo số mới; giữ nguyên mã", async () => {
    const r = await newReceipt();
    await tx((t) => editReceipt(t, acc, r.id, rBody({ amount: 600_000, cashAccountId: bank.id }), NOW));
    expect((await bal(cash.id)).balance.toString()).toBe("0"); expect((await bal(bank.id)).balance.toString()).toBe("600000");
    expect(await pBal(customer.id)).toBe("-600000");
    expect(await prisma.cashLedger.count()).toBe(1); expect(await prisma.partnerLedger.count()).toBe(1);
    expect((await prisma.cashReviewEvent.findMany({ where: { docId: r.id } })).map((e) => e.action)).toEqual(["SUBMIT", "EDIT"]);
  });
  it("sửa phiếu chi; đổi loại bị chặn", async () => {
    const p = await newPayment();
    await tx((t) => editPayment(t, acc, p.id, pBody({ amount: 100_000 }), NOW));
    expect(await pBal(supplier.id)).toBe("100000");
    expect((await errOf(tx((t) => editPayment(t, acc, p.id, pBody({ kind: "KHAC", partnerId: null }), NOW))))?.status).toBe(409);
  });
  it("hủy phiếu chưa kiểm đảo về 0 cả quỹ lẫn công nợ và không sửa/hủy lại được", async () => {
    const r = await newReceipt(); const p = await newPayment();
    await tx((t) => cancelVoucher(t, acc, "RECEIPT", r.id, "sai", NOW)); await tx((t) => cancelVoucher(t, acc, "PAYMENT", p.id, "sai", NOW));
    expect((await bal()).balance.toString()).toBe("0"); expect(await prisma.partnerLedger.count()).toBe(0); expect(await prisma.cashLedger.count()).toBe(0);
    expect((await errOf(tx((t) => cancelVoucher(t, acc, "RECEIPT", r.id, "x", NOW))))?.status).toBe(409);
    expect((await errOf(tx((t) => editReceipt(t, acc, r.id, rBody(), NOW))))?.status).toBe(409);
  });
});

describe("hậu kiểm", () => {
  it("kiểm tra: khoá sửa/hủy trực tiếp; thiếu cash.review bị chặn ở server; chỉ REVIEWED tính vào 'đã kiểm'", async () => {
    const r = await newReceipt();
    expect((await errOf(tx((t) => reviewVoucher(t, acc, "RECEIPT", r.id))))?.status).toBe(403);
    await tx((t) => reviewVoucher(t, tre, "RECEIPT", r.id, NOW));
    const b = await bal(); expect([b.balance, b.reviewed, b.pending].map(String)).toEqual(["1000000", "1000000", "0"]);
    expect((await errOf(tx((t) => editReceipt(t, acc, r.id, rBody({ amount: 1 }), NOW))))?.code).toBe("VOUCHER_REVIEWED");
    expect((await errOf(tx((t) => cancelVoucher(t, acc, "RECEIPT", r.id, "x", NOW))))?.code).toBe("VOUCHER_REVIEWED");
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: r.id } })).reviewedBy).toBe(tre.userId);
  });
  it("[R] hai thủ quỹ kiểm cùng phiếu: đúng một bên thắng, bên kia 409, chỉ một sự kiện REVIEW", async () => {
    const r = await newReceipt();
    const res = await Promise.all([tx((t) => reviewVoucher(t, tre, "RECEIPT", r.id)).then(() => "ok", (e) => e.status), tx((t) => reviewVoucher(t, tre, "RECEIPT", r.id)).then(() => "ok", (e) => e.status)]);
    expect(res.sort()).toEqual([409, "ok"]);
    expect(await prisma.cashReviewEvent.count({ where: { docId: r.id, action: "REVIEW" } })).toBe(1);
  });
  it("trả lại (kèm lý do) → sửa → tự về chờ kiểm; chưa sửa thì không kiểm được; sổ vẫn ghi trong lúc bị trả lại", async () => {
    const r = await newReceipt();
    await tx((t) => returnVoucher(t, tre, "RECEIPT", r.id, "sai số tiền"));
    expect(await status(r.id)).toBe("RETURNED");
    expect((await bal()).pending.toString()).toBe("1000000");
    expect((await errOf(tx((t) => reviewVoucher(t, tre, "RECEIPT", r.id))))?.status).toBe(409);
    await tx((t) => editReceipt(t, acc, r.id, rBody({ amount: 900_000 }), NOW));
    expect(await status(r.id)).toBe("PENDING_REVIEW");
    await tx((t) => reviewVoucher(t, tre, "RECEIPT", r.id));
    expect((await prisma.cashReviewEvent.findMany({ where: { docId: r.id }, orderBy: { id: "asc" } })).map((e) => e.action)).toEqual(["SUBMIT", "RETURN", "RESUBMIT", "REVIEW"]);
    expect((await prisma.cashReviewEvent.findFirstOrThrow({ where: { action: "RETURN" } })).reason).toBe("sai số tiền");
  });
});

describe("điều chỉnh phiếu đã kiểm tra", () => {
  const reviewed = async () => { const r = await newReceipt(); await tx((t) => reviewVoucher(t, tre, "RECEIPT", r.id, NOW)); return r; };
  it("đổi số tiền + quỹ: dòng gốc giữ nguyên, thêm dòng đảo + dòng mới; số dư và công nợ theo số mới", async () => {
    const r = await reviewed();
    const req = await tx((t) => requestAdjustment(t, acc, "RECEIPT", r.id, adjustmentRequestSchema.parse({ kind: "AMOUNT", reason: "ghi thiếu", newAmount: 1_200_000, newCashAccountId: bank.id })));
    expect((await bal()).balance.toString()).toBe("1000000"); // chưa duyệt: chưa đổi
    const d = await tx((t) => decideAdjustment(t, tre, req.id, { approve: true, note: "" }, NOW));
    expect(d.status).toBe("APPROVED");
    expect((await bal(cash.id)).balance.toString()).toBe("0"); expect((await bal(bank.id)).balance.toString()).toBe("1200000");
    expect(await pBal(customer.id)).toBe("-1200000");
    const rows = await prisma.cashLedger.findMany({ orderBy: { id: "asc" } });
    expect(rows.map((x) => [x.docType, String(x.amountIn), String(x.amountOut)])).toEqual([["RECEIPT", "1000000", "0"], ["CASH_ADJ", "0", "1000000"], ["CASH_ADJ", "1200000", "0"]]);
    const v = await prisma.receipt.findUniqueOrThrow({ where: { id: r.id } });
    expect([String(v.amount), v.cashAccountId, v.reviewStatus]).toEqual(["1200000", bank.id, "REVIEWED"]);
    expect((await bal(bank.id)).pending.toString()).toBe("0"); // dòng điều chỉnh đã duyệt tính là đã kiểm
    const a = await prisma.cashAdjustment.findUniqueOrThrow({ where: { id: req.id } });
    expect([String(a.oldAmount), a.oldCashAccountId, a.decidedBy]).toEqual(["1000000", cash.id, tre.userId]);
  });
  it("hủy phiếu đã kiểm (VOID): về 0 cả quỹ lẫn công nợ, phiếu đánh dấu hủy, dòng gốc còn để truy vết", async () => {
    const r = await reviewed();
    const req = await tx((t) => requestAdjustment(t, acc, "RECEIPT", r.id, adjustmentRequestSchema.parse({ kind: "VOID", reason: "nhập nhầm khách" })));
    await tx((t) => decideAdjustment(t, tre, req.id, { approve: true, note: "ok" }, NOW));
    expect((await bal()).balance.toString()).toBe("0"); expect(await pBal(customer.id)).toBe("0");
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: r.id } })).isCancelled).toBe(true);
    expect(await prisma.cashLedger.count()).toBe(2);
  });
  it("phiếu chi: đảo đúng chiều (quỹ vào lại, công nợ NCC credit)", async () => {
    const p = await newPayment(); await tx((t) => reviewVoucher(t, tre, "PAYMENT", p.id, NOW));
    const req = await tx((t) => requestAdjustment(t, acc, "PAYMENT", p.id, adjustmentRequestSchema.parse({ kind: "AMOUNT", reason: "chi 300k", newAmount: 300_000, newCashAccountId: null })));
    await tx((t) => decideAdjustment(t, tre, req.id, { approve: true, note: "" }, NOW));
    expect((await bal()).balance.toString()).toBe("-300000"); expect(await pBal(supplier.id)).toBe("300000");
  });
  it("từ chối không đổi gì; mỗi phiếu một yêu cầu chờ; duyệt hai lần / duyệt đồng thời chỉ một lần; điều chỉnh phiếu chưa kiểm bị chặn; thiếu quyền duyệt bị chặn", async () => {
    const r = await reviewed();
    const req = await tx((t) => requestAdjustment(t, acc, "RECEIPT", r.id, adjustmentRequestSchema.parse({ kind: "VOID", reason: "x" })));
    expect((await errOf(tx((t) => requestAdjustment(t, acc, "RECEIPT", r.id, adjustmentRequestSchema.parse({ kind: "VOID", reason: "y" })))))?.code).toBe("ADJUSTMENT_PENDING");
    expect((await errOf(tx((t) => decideAdjustment(t, acc, req.id, { approve: true, note: "" }))))?.status).toBe(403);
    await tx((t) => decideAdjustment(t, tre, req.id, { approve: false, note: "không hợp lý" }));
    expect((await bal()).balance.toString()).toBe("1000000"); expect(await prisma.cashLedger.count()).toBe(1);
    expect((await errOf(tx((t) => decideAdjustment(t, tre, req.id, { approve: true, note: "" }))))?.code).toBe("ALREADY_DECIDED");
    const req2 = await tx((t) => requestAdjustment(t, acc, "RECEIPT", r.id, adjustmentRequestSchema.parse({ kind: "VOID", reason: "z" })));
    const res = await Promise.all([tx((t) => decideAdjustment(t, tre, req2.id, { approve: true, note: "" })).then(() => "ok", (e) => e.status), tx((t) => decideAdjustment(t, tre, req2.id, { approve: true, note: "" })).then(() => "ok", (e) => e.status)]);
    expect(res.sort()).toEqual([409, "ok"]); expect((await bal()).balance.toString()).toBe("0");
    const fresh = await newReceipt();
    expect((await errOf(tx((t) => requestAdjustment(t, acc, "RECEIPT", fresh.id, adjustmentRequestSchema.parse({ kind: "VOID", reason: "x" })))))?.status).toBe(409);
    expect(decideAdjustmentSchema.safeParse({ approve: false, note: "" }).success).toBe(false);
    expect(adjustmentRequestSchema.safeParse({ kind: "AMOUNT", reason: "x" }).success).toBe(false);
  });
});

describe("chốt quỹ", () => {
  it("expected = đầu kỳ + thu − chi đến mốc; chênh lệch bắt buộc lý do nhưng vẫn cho chốt; snapshot; hủy chốt cần quyền riêng", async () => {
    await prisma.openingCash.create({ data: { periodId: w.periodId, cashAccountId: cash.id, amount: 1_000_000 } });
    await newReceipt({ amount: 500_000 }); await newPayment({ amount: 200_000, kind: "KHAC", partnerId: null });
    const body = (over: Record<string, unknown> = {}) => cashCloseSchema.parse({ cashAccountId: cash.id, closeAt: NOW.toISOString(), actual: 1_300_000, reason: "", ...over });
    const c = await tx((t) => createCashClose(t, tre, body(), NOW));
    expect(c).toMatchObject({ expected: "1300000", diff: "0" });
    expect((await errOf(tx((t) => createCashClose(t, tre, body({ actual: 1_250_000 }), NOW))))?.code).toBe("DIFF_REASON_REQUIRED");
    const c2 = await tx((t) => createCashClose(t, tre, body({ actual: 1_250_000, reason: "thiếu 50k, đang tìm" }), NOW));
    expect(c2.diff).toBe("-50000");
    expect((await prisma.cashClose.findUniqueOrThrow({ where: { id: c2.id } })).expected.toString()).toBe("1300000");
    expect((await errOf(tx((t) => createCashClose(t, acc, body(), NOW))))?.status).toBe(403);
    expect((await errOf(tx((t) => createCashClose(t, tre, body({ closeAt: "2026-12-01T00:00:00Z" }), NOW))))?.status).toBe(400);
    const early = await tx((t) => createCashClose(t, tre, body({ closeAt: "2026-09-14T00:00:00Z", actual: 1_000_000 }), NOW)); // mốc trước phát sinh
    expect(early.expected).toBe("1000000");
    const noReopen: Actor = { userId: tre.userId, perms: new Set(TRE.filter((p) => p !== "cash.close.reopen")) };
    expect((await errOf(tx((t) => voidCashClose(t, noReopen, c2.id, "sai", NOW))))?.status).toBe(403);
    await tx((t) => voidCashClose(t, tre, c2.id, "chốt nhầm mốc", NOW));
    expect((await errOf(tx((t) => voidCashClose(t, tre, c2.id, "x", NOW))))?.status).toBe(409);
    expect((await bal()).balance.toString()).toBe("1300000"); // chốt quỹ không đổi sổ
  });
});

describe("phiếu cọc (plan 04) vào sổ quỹ", () => {
  it("cọc ghi sổ quỹ + sự kiện; hủy cọc gỡ sổ quỹ; cọc đã kiểm không hủy trực tiếp được", async () => {
    await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
    const mk = async (k: string) => createSaleOrderIdempotent(prisma, acc, k, saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 4, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: null, note: "" }] }), NOW);
    const o1 = await mk("o1"); const o2 = await mk("o2");
    const dep = (orderId: number) => tx((t) => createDeposit(t, acc, depositSchema.parse({ orderId, amount: 80_000, cashAccountId: cash.id, date: "2026-09-15", note: "" }), NOW));
    const d1 = await dep(o1.id); const d2 = await dep(o2.id);
    expect((await bal()).balance.toString()).toBe("160000");
    await tx((t) => cancelDeposit(t, acc, d1.id, NOW));
    expect((await bal()).balance.toString()).toBe("80000");
    await tx((t) => reviewVoucher(t, tre, "RECEIPT", d2.id));
    expect((await errOf(tx((t) => cancelDeposit(t, acc, d2.id, NOW))))?.code).toBe("VOUCHER_REVIEWED");
  });
  it("backfill của migration dựng cash_ledger cho phiếu cọc cũ, chạy lại không nhân đôi, bỏ qua phiếu đã hủy", async () => {
    const mk = (over: Record<string, unknown>) => prisma.receipt.create({ data: { code: `PTX${Math.random()}`, periodId: w.periodId, partnerId: customer.id, type: "COC", amount: 70_000, cashAccountId: cash.id, at: NOW, createdBy: w.userId, ...over } });
    await mk({}); await mk({ isCancelled: true, cancelledAt: NOW });
    const sql = readFileSync("prisma/migrations/20260930230000_cash_vouchers/migration.sql", "utf8");
    const start = sql.indexOf('INSERT INTO "cash_ledger"'); const stmt = sql.slice(start, sql.indexOf(";", start) + 1);
    await prisma.$executeRawUnsafe(stmt); await prisma.$executeRawUnsafe(stmt);
    expect(await prisma.cashLedger.count()).toBe(1); expect((await bal()).balance.toString()).toBe("70000");
  });
});
