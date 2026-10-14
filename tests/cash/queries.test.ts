import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { decideAdjustment, requestAdjustment } from "@/server/cash/adjust";
import { exportCashBookXlsx } from "@/server/cash/export";
import { getVoucher, listCashBook, listPartnerOrders, listReviewQueue, listVouchers, QUEUE_FILTER_KEYS, searchCashPartners, VOUCHER_FILTER_KEYS } from "@/server/cash/queries";
import { adjustmentRequestSchema, paymentSchema, receiptSchema } from "@/server/cash/schemas";
import { createPayment, createReceipt, returnVoucher, reviewVoucher } from "@/server/cash/vouchers";
import { getDebtDetail } from "@/server/debt/queries";
import { loadBankReceipts } from "@/server/home/dashboard/bank-receipts";
import { dashRange } from "@/server/home/dashboard/common";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner } from "../helpers/factories";
import { newWorld, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
const ACC = ["receipt.manage", "payment.manage", "cash.transaction.create", "cash.transaction.edit_pending", "cash.adjust.request", "cashbook.view", "debt.view", "partner.view_all"];
const TRE = [...ACC, "cash.review", "cash.adjust.approve", "cash.close", "cash.close.reopen"];
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let acc: Actor; let tre: Actor; let customer: { id: number }; let supplier: { id: number }; let cash: { id: number }; let bank: { id: number };
const P = (sp: Record<string, string> = {}, keys: readonly string[] = VOUCHER_FILTER_KEYS) => parseListParams(sp, keys);
const rec = (over: Record<string, unknown> = {}) => tx((t) => createReceipt(t, acc, receiptSchema.parse({ type: "THU_NO", partnerId: customer.id, orderId: null, cashAccountId: cash.id, amount: 1_000_000, date: "2026-09-15", note: "", ...over }), NOW));
const pay = (over: Record<string, unknown> = {}) => tx((t) => createPayment(t, acc, paymentSchema.parse({ kind: "TRA_NCC", partnerId: supplier.id, cashAccountId: cash.id, amount: 400_000, date: "2026-09-15", note: "", ...over }), NOW));

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  acc = { userId: w.userId, perms: new Set(ACC) };
  tre = { userId: (await prisma.user.create({ data: { username: "tq", passwordHash: "x", fullName: "Thủ quỹ" } })).id, perms: new Set(TRE) };
  customer = await makePartner({ isCustomer: true, name: "Khách Đạt", searchText: "khach dat" }); supplier = await makePartner({ isCustomer: false, isSupplier: true });
  cash = await makeCashAccount({ name: "Tiền mặt" }); bank = await makeCashAccount({ type: "BANK", name: "VCB", bankNo: "0123" });
});

describe("danh sách phiếu", () => {
  it("đếm theo trạng thái hậu kiểm, lọc trạng thái/loại/từ khoá, phân trang; phiếu hủy tách riêng", async () => {
    const a = await rec(); const b = await rec({ amount: 500_000 }); const c = await rec({ type: "KHAC", partnerId: null });
    await tx((t) => reviewVoucher(t, tre, "RECEIPT", a.id)); await tx((t) => returnVoucher(t, tre, "RECEIPT", b.id, "sai"));
    const all = await listVouchers(prisma, acc, "RECEIPT", P());
    expect(all.total).toBe(3); expect(all.stats).toMatchObject({ pending: 1, returned: 1, reviewed: 1, pendingAmount: "1500000" });
    expect((await listVouchers(prisma, acc, "RECEIPT", P({ status: "REVIEWED" }))).rows.map((r) => r.code)).toEqual([a.code]);
    expect((await listVouchers(prisma, acc, "RECEIPT", P({ type: "KHAC" }))).rows.map((r) => r.id)).toEqual([c.id]);
    expect((await listVouchers(prisma, acc, "RECEIPT", P({ q: "dat" }))).total).toBe(2);
    expect((await listVouchers(prisma, acc, "RECEIPT", P({ pageSize: "10", page: "1" }))).rows).toHaveLength(3);
    await prisma.receipt.update({ where: { id: c.id }, data: { isCancelled: true, cancelledAt: NOW } });
    expect((await listVouchers(prisma, acc, "RECEIPT", P({ status: "CANCELLED" }))).rows.map((r) => r.id)).toEqual([c.id]);
    expect((await listVouchers(prisma, acc, "RECEIPT", P())).stats.pending).toBe(0);
  });
  it("chặn người thiếu quyền; danh sách phiếu chi tách với phiếu thu", async () => {
    await rec(); await pay();
    const onlyRec: Actor = { userId: 1, perms: new Set(["receipt.manage"]) };
    await expect(listVouchers(prisma, onlyRec, "PAYMENT", P())).rejects.toMatchObject({ message: expect.stringMatching(/quyền/i) });
    expect((await listVouchers(prisma, acc, "PAYMENT", P())).rows.map((r) => r.typeLabel)).toEqual(["Trả nhà cung cấp"]);
  });
});

describe("chi tiết phiếu", () => {
  it("có lịch sử người/lý do và các lần điều chỉnh; 404 khi không có", async () => {
    const r = await rec();
    await tx((t) => returnVoucher(t, tre, "RECEIPT", r.id, "thiếu chứng từ"));
    const d = await getVoucher(prisma, acc, "RECEIPT", r.id);
    expect(d).toMatchObject({ code: r.code, typeLabel: "Thu nợ", partnerName: "Khách Đạt", reviewStatus: "RETURNED", amount: "1000000", dateYmd: "2026-09-15" });
    expect(d.events.map((e) => [e.action, e.reason, e.userName])).toEqual([["SUBMIT", null, expect.any(String)], ["RETURN", "thiếu chứng từ", "Thủ quỹ"]]);
    await expect(getVoucher(prisma, acc, "RECEIPT", 99999)).rejects.toMatchObject({ status: 404 });
    const p = await pay(); await tx((t) => reviewVoucher(t, tre, "PAYMENT", p.id));
    const req = await tx((t) => requestAdjustment(t, acc, "PAYMENT", p.id, adjustmentRequestSchema.parse({ kind: "AMOUNT", reason: "chi 300k", newAmount: 300_000, newCashAccountId: bank.id })));
    await tx((t) => decideAdjustment(t, tre, req.id, { approve: true, note: "ok" }, NOW));
    const dp = await getVoucher(prisma, acc, "PAYMENT", p.id);
    expect(dp.adjustments).toHaveLength(1);
    expect(dp.adjustments[0]).toMatchObject({ status: "APPROVED", oldAmount: "400000", newAmount: "300000", newCashAccountName: "VCB", decidedByName: "Thủ quỹ" });
  });
});

describe("hàng chờ kiểm tra", () => {
  it("gồm phiếu chờ + bị trả lại + yêu cầu điều chỉnh; bỏ phiếu đã kiểm/đã hủy; lọc loại/trạng thái; chỉ người có cash.review", async () => {
    const a = await rec(); const b = await rec(); const c = await pay(); const done = await rec();
    await tx((t) => reviewVoucher(t, tre, "RECEIPT", done.id)); await tx((t) => returnVoucher(t, tre, "RECEIPT", b.id, "x"));
    await tx((t) => reviewVoucher(t, tre, "PAYMENT", c.id));
    await tx((t) => requestAdjustment(t, acc, "PAYMENT", c.id, adjustmentRequestSchema.parse({ kind: "VOID", reason: "nhầm" })));
    const q = await listReviewQueue(prisma, tre, P({}, QUEUE_FILTER_KEYS));
    expect(q.rows.map((r) => [r.kind, r.status]).sort()).toEqual([["ADJUSTMENT", "ADJUST_REQUESTED"], ["RECEIPT", "PENDING_REVIEW"], ["RECEIPT", "RETURNED"]]);
    expect(q.rows.find((r) => r.kind === "ADJUSTMENT")).toMatchObject({ code: c.code, detail: "nhầm", adjustmentId: expect.any(Number) });
    expect((await listReviewQueue(prisma, tre, P({ kind: "ADJUSTMENT" }, QUEUE_FILTER_KEYS))).total).toBe(1);
    expect((await listReviewQueue(prisma, tre, P({ status: "RETURNED" }, QUEUE_FILTER_KEYS))).rows.map((r) => r.id)).toEqual([b.id]);
    expect(a.id).toBeGreaterThan(0);
    await expect(listReviewQueue(prisma, acc, P())).rejects.toMatchObject({ message: expect.stringMatching(/quyền/i) });
  });
});

describe("sổ quỹ / sổ ngân hàng", () => {
  it("dashboard tiền nhận: chỉ thu ngân hàng trong ngày, bỏ hủy, tách hậu kiểm và ưu tiên phiếu trả lại", async () => {
    await rec({ amount: 900_000 }); // tiền mặt không vào tổng ngân hàng
    const pending = await rec({ cashAccountId: bank.id, amount: 300_000 });
    const returned = await rec({ cashAccountId: bank.id, amount: 200_000 });
    const reviewed = await rec({ cashAccountId: bank.id, amount: 100_000 });
    const cancelled = await rec({ cashAccountId: bank.id, amount: 800_000 });
    await prisma.receipt.update({ where: { id: cancelled.id }, data: { isCancelled: true } });
    await tx((t) => returnVoucher(t, tre, "RECEIPT", returned.id, "kiểm tra lại khách hàng"));
    await tx((t) => reviewVoucher(t, tre, "RECEIPT", reviewed.id));
    const range = dashRange("today", undefined, NOW);
    const data = await loadBankReceipts(prisma, tre, range);
    expect(data).toMatchObject({ recorded: "600000", reviewed: 1, pending: 1, returned: 1, selectedAccount: null });
    expect(data!.tasks.map((r) => r.id)).toEqual([returned.id, pending.id]);
    expect(data!.tasks[0]).toMatchObject({ partnerName: "Khách Đạt", status: "RETURNED" });
    expect(data!.tasksHref).toContain("cashType=BANK");
    expect(data!.tasksHref).toContain("timeStart=2026-09-15");
    expect(data!.accounts[0]!.bookHref).toContain(`account=${bank.id}`);
    expect(await loadBankReceipts(prisma, tre, dashRange("today", undefined, new Date("2026-09-16T03:00:00Z")))).toMatchObject({ recorded: "0", tasks: [] });
  });
  it("lọc tài khoản được giữ khi mở danh sách phiếu và hàng chờ; thiếu quyền không lấy dữ liệu ngân hàng", async () => {
    const otherBank = await makeCashAccount({ type: "BANK", name: "MB" });
    const wanted = await rec({ cashAccountId: bank.id, amount: 100_000 });
    await rec({ cashAccountId: otherBank.id, amount: 200_000 }); await rec({ amount: 300_000 });
    const range = dashRange("today", undefined, NOW);
    expect(await loadBankReceipts(prisma, acc, range, String(bank.id))).toMatchObject({ recorded: "100000", selectedAccount: bank.id, pending: 1 });
    expect(await loadBankReceipts(prisma, acc, range, "999999999")).toMatchObject({ recorded: "300000", selectedAccount: null });
    const search = { account: String(bank.id), cashType: "BANK", timePreset: "custom", timeStart: "2026-09-15", timeEnd: "2026-09-15", kind: "RECEIPT" };
    const vouchers = await listVouchers(prisma, acc, "RECEIPT", P(search));
    expect(vouchers.rows.map((r) => r.id)).toEqual([wanted.id]);
    expect(vouchers.stats).toMatchObject({ pending: 1, pendingAmount: "100000" });
    expect((await listReviewQueue(prisma, tre, P(search, QUEUE_FILTER_KEYS))).rows.map((r) => r.id)).toEqual([wanted.id]);
    expect(await loadBankReceipts(prisma, { userId: acc.userId, perms: new Set(["debt.view"]) }, range)).toBeUndefined();
    const readonly = await loadBankReceipts(prisma, { userId: acc.userId, perms: new Set(["cashbook.view"]) }, range);
    expect(readonly!.tasksHref).toBeUndefined();
    expect(readonly!.tasks[0]!.href).toContain("/accounting/bankbook?");
  });
  it("lọc ngày sổ ngân hàng không bỏ số dư chạy từ phát sinh trước đó", async () => {
    const first = await rec({ cashAccountId: bank.id, amount: 300_000 });
    await prisma.cashLedger.updateMany({ where: { docType: "RECEIPT", docId: first.id }, data: { at: new Date("2026-09-14T03:00:00Z") } });
    await rec({ cashAccountId: bank.id, amount: 200_000 });
    const book = await listCashBook(prisma, acc, "BANK", bank.id, P({ timePreset: "custom", timeStart: "2026-09-15", timeEnd: "2026-09-15" }, []));
    expect(book.total).toBe(1);
    expect(book.entries[0]).toMatchObject({ amountIn: "200000", running: "500000" });
  });
  it("số dư chạy đúng, tách đã kiểm/chờ kiểm, tách sổ quỹ với sổ NH, xuất Excel; không có cashbook.view bị chặn", async () => {
    await prisma.openingCash.create({ data: { periodId: w.periodId, cashAccountId: cash.id, amount: 1_000_000 } });
    const r = await rec({ amount: 500_000 }); await pay({ kind: "KHAC", partnerId: null, amount: 200_000 }); await rec({ cashAccountId: bank.id, amount: 300_000 });
    await tx((t) => reviewVoucher(t, tre, "RECEIPT", r.id));
    const book = await listCashBook(prisma, acc, "CASH", null, P({}, []));
    expect(book.accounts.map((a) => a.name)).toEqual(["Tiền mặt"]);
    expect(book.selected).toMatchObject({ opening: "1000000", in: "500000", out: "200000", balance: "1300000", reviewed: "1500000", pending: "-200000" });
    expect(book.entries.map((e) => e.running)).toEqual(["1300000", "1500000"]); // mới nhất trước
    expect(book.entries.find((e) => e.docType === "RECEIPT")).toMatchObject({ docCode: r.code, reviewStatus: "REVIEWED" });
    const bk = await listCashBook(prisma, acc, "BANK", bank.id, P({}, []));
    expect(bk.selected).toMatchObject({ name: "VCB", balance: "300000", pending: "300000" });
    const xlsx = await exportCashBookXlsx(prisma, acc, "CASH", cash.id);
    expect(xlsx.byteLength).toBeGreaterThan(1000);
    await expect(listCashBook(prisma, { userId: 1, perms: new Set(["receipt.manage"]) }, "CASH", null, P({}, []))).rejects.toMatchObject({ message: expect.stringMatching(/quyền/i) });
    const empty = await listCashBook(prisma, acc, "CASH", 99999, P({}, [])); // quỹ không thuộc loại này ⇒ rơi về quỹ đầu tiên
    expect(empty.selected?.name).toBe("Tiền mặt");
  });
  it("công nợ đối tác hiện phiếu chi/điều chỉnh có mã và liên kết", async () => {
    const p = await pay(); await tx((t) => reviewVoucher(t, tre, "PAYMENT", p.id));
    const req = await tx((t) => requestAdjustment(t, acc, "PAYMENT", p.id, adjustmentRequestSchema.parse({ kind: "VOID", reason: "nhầm" }))); await tx((t) => decideAdjustment(t, tre, req.id, { approve: true, note: "" }, NOW));
    const d = await getDebtDetail(prisma, acc, supplier.id, P({}, []));
    expect(d.entries.map((e) => [e.docType, e.docLabel])).toEqual([["CASH_ADJ", "Điều chỉnh phiếu thu/chi"], ["PAYMENT", "Phiếu chi"]]);
    expect(d.entries.find((e) => e.docType === "PAYMENT")).toMatchObject({ docCode: p.code, docHref: `/accounting/payments/${p.id}` });
    expect(d.balance).toBe("0");
  });
});

describe("ô chọn trong form", () => {
  it("tìm đối tác theo vai trò, đơn của khách, cần cash.transaction.create", async () => {
    expect((await searchCashPartners(prisma, acc, "dat", "customer")).map((o) => o.value)).toEqual([customer.id]);
    expect((await searchCashPartners(prisma, acc, "", "supplier")).map((o) => o.value)).toEqual([supplier.id]);
    expect(await listPartnerOrders(prisma, acc, customer.id)).toEqual([]);
    await expect(searchCashPartners(prisma, { userId: 1, perms: new Set() }, "", "any")).rejects.toMatchObject({ message: expect.stringMatching(/quyền/i) });
  });
});
