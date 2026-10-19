import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { requestAdjustment, decideAdjustment } from "@/server/cash/adjust";
import { cashBalance } from "@/server/cash/balance";
import { createExpense, createExpenseIdempotent, editExpense, expenseSchema } from "@/server/cash/expenses";
import { exportExpensesXlsx } from "@/server/cash/expense-export";
import { EXPENSE_FILTER_KEYS, getExpense, getVoucher, listExpenses } from "@/server/cash/queries";
import { adjustmentRequestSchema } from "@/server/cash/schemas";
import { cancelVoucher, returnVoucher, reviewVoucher } from "@/server/cash/vouchers";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount } from "../helpers/factories";
import { newWorld, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
const KT = ["expense.manage", "cash.transaction.create", "cash.transaction.edit_pending", "cash.adjust.request"];
const TQ = [...KT, "cash.review", "cash.adjust.approve", "payment.manage"];
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let kt: Actor; let tq: Actor; let cash: { id: number }; let dien: { id: number }; let luong: { id: number };
const body = (over: Record<string, unknown> = {}) => expenseSchema.parse({ expenseTypeId: dien.id, cashAccountId: cash.id, amount: 800_000, date: "2026-09-15", note: "Tiền điện tháng 9", ...over });
const newExp = (over: Record<string, unknown> = {}, at = NOW) => tx((t) => createExpense(t, kt, body(over), at));
const P = (sp: Record<string, string> = {}) => parseListParams(sp, EXPENSE_FILTER_KEYS);

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  kt = { userId: w.userId, perms: new Set(KT) };
  tq = { userId: (await prisma.user.create({ data: { username: "tq", passwordHash: "x", fullName: "Thủ quỹ" } })).id, perms: new Set(TQ) };
  cash = await makeCashAccount({ name: "Tiền mặt" });
  dien = await prisma.expenseType.create({ data: { name: "Điện" } }); luong = await prisma.expenseType.create({ data: { name: "Lương" } });
});

describe("chi phí hoạt động (66)", () => {
  it("lưu và sửa người ứng tiền trên phiếu chi, trả lại dữ liệu khi sửa, không sinh công nợ", async () => {
    const e = await newExp({ advancedById: w.userId });
    expect((await getExpense(prisma, kt, e.id)).advancedBy?.value).toBe(w.userId);
    await tx(t => editExpense(t, kt, e.id, body({ advancedById: tq.userId }), NOW));
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: e.paymentId } })).advancedById).toBe(tq.userId);
    await tx(t => editExpense(t, kt, e.id, body({ advancedById: null }), NOW));
    expect((await getExpense(prisma, kt, e.id)).advancedBy).toBeNull();
    expect(await prisma.cashLedger.count()).toBe(1);
    expect(await prisma.partnerLedger.count()).toBe(0);
  });
  it("từ chối người ứng tiền không tồn tại hoặc bị khóa khi lập và sửa", async () => {
    await expect(newExp({ advancedById: 999999 })).rejects.toMatchObject({ status: 400 });
    const e = await newExp();
    await prisma.user.update({ where: { id: tq.userId }, data: { isLocked: true } });
    await expect(tx(t => editExpense(t, kt, e.id, body({ advancedById: tq.userId }), NOW))).rejects.toMatchObject({ status: 400 });
    expect((await getExpense(prisma, kt, e.id)).advancedBy).toBeNull();
  });
  it("một khoản = một phiếu chi CHI_PHI: quỹ ra, KHÔNG đụng công nợ, chờ kiểm tra, có audit", async () => {
    const e = await newExp();
    expect(e.code).toMatch(/^PC\d{6}$/);
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: e.paymentId } });
    expect([pay.kind, String(pay.amount), pay.partnerId, pay.reviewStatus]).toEqual(["CHI_PHI", "800000", null, "PENDING_REVIEW"]);
    expect(await prisma.partnerLedger.count()).toBe(0);
    expect((await cashBalance(prisma, w.periodId, cash.id)).balance.toString()).toBe("-800000");
    expect(await prisma.auditLog.count({ where: { action: "expense.create" } })).toBe(1);
    expect((await prisma.operatingExpense.findUniqueOrThrow({ where: { id: e.id } })).expenseTypeId).toBe(dien.id);
  });
  it("bấm 2 lần cùng khoá = 1 khoản; quyền: cần expense.manage + cash.transaction.create; loại tắt/không có bị từ chối", async () => {
    await createExpenseIdempotent(prisma, kt, "k", body()); await createExpenseIdempotent(prisma, kt, "k", body());
    expect(await prisma.operatingExpense.count()).toBe(1); expect(await prisma.payment.count()).toBe(1);
    const noCreate: Actor = { userId: 1, perms: new Set(["expense.manage"]) };
    await expect(tx((t) => createExpense(t, noCreate, body(), NOW))).rejects.toMatchObject({ status: 403 });
    const onlyPay: Actor = { userId: 1, perms: new Set(["payment.manage", "cash.transaction.create"]) };
    await expect(tx((t) => createExpense(t, onlyPay, body(), NOW))).rejects.toMatchObject({ status: 403 });
    await prisma.expenseType.update({ where: { id: luong.id }, data: { isActive: false } });
    await expect(tx((t) => createExpense(t, kt, body({ expenseTypeId: luong.id }), NOW))).rejects.toMatchObject({ status: 400 });
    await expect(tx((t) => createExpense(t, kt, body({ expenseTypeId: 9999 }), NOW))).rejects.toMatchObject({ status: 400 });
    expect(expenseSchema.safeParse({ ...body(), amount: 0 }).success).toBe(false);
  });
  it("sửa khi chưa kiểm: đổi loại/số tiền/quỹ, sổ quỹ gỡ & ghi lại; sau khi kiểm không sửa trực tiếp; bị trả lại sửa xong gửi lại", async () => {
    const bank = await makeCashAccount({ type: "BANK", name: "VCB" });
    const e = await newExp();
    await tx((t) => editExpense(t, kt, e.id, body({ expenseTypeId: luong.id, amount: 900_000, cashAccountId: bank.id }), NOW));
    expect((await cashBalance(prisma, w.periodId, cash.id)).balance.toString()).toBe("0");
    expect((await cashBalance(prisma, w.periodId, bank.id)).balance.toString()).toBe("-900000");
    expect(await prisma.cashLedger.count()).toBe(1);
    expect((await getExpense(prisma, kt, e.id))).toMatchObject({ expenseTypeId: luong.id, amount: "900000" });
    await tx((t) => returnVoucher(t, tq, "PAYMENT", e.paymentId, "thiếu hoá đơn"));
    await tx((t) => editExpense(t, kt, e.id, body({ amount: 950_000, cashAccountId: bank.id }), NOW));
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: e.paymentId } })).reviewStatus).toBe("PENDING_REVIEW");
    await tx((t) => reviewVoucher(t, tq, "PAYMENT", e.paymentId));
    await expect(tx((t) => editExpense(t, kt, e.id, body(), NOW))).rejects.toMatchObject({ code: "VOUCHER_REVIEWED" });
    await expect(tx((t) => editExpense(t, kt, 9999, body(), NOW))).rejects.toMatchObject({ status: 404 });
  });
  it("hủy chưa kiểm qua phiếu chi đảo quỹ về 0 và khoản hiện 'Đã hủy'; chi phí đã kiểm điều chỉnh số tiền qua duyệt; chi tiết phiếu chi hiện loại chi phí + liên kết sửa", async () => {
    const a = await newExp(); const b = await newExp({ amount: 300_000, expenseTypeId: luong.id });
    await tx((t) => cancelVoucher(t, kt, "PAYMENT", a.paymentId, "nhập nhầm", NOW));
    expect((await cashBalance(prisma, w.periodId, cash.id)).balance.toString()).toBe("-300000");
    await tx((t) => reviewVoucher(t, tq, "PAYMENT", b.paymentId));
    const req = await tx((t) => requestAdjustment(t, kt, "PAYMENT", b.paymentId, adjustmentRequestSchema.parse({ kind: "AMOUNT", reason: "thực chi 350k", newAmount: 350_000, newCashAccountId: null })));
    await tx((t) => decideAdjustment(t, tq, req.id, { approve: true, note: "" }, NOW));
    expect((await cashBalance(prisma, w.periodId, cash.id)).balance.toString()).toBe("-350000");
    const d = await getVoucher(prisma, tq, "PAYMENT", b.paymentId);
    expect(d).toMatchObject({ typeLabel: "Chi phí — Lương", expenseId: b.id, amount: "350000" });
  });
  it("danh sách + tổng theo loại/tháng (bỏ khoản đã hủy), lọc loại/trạng thái/từ khoá, xuất Excel; chặn thiếu quyền", async () => {
    const sep = await newExp({ amount: 800_000 });
    const sep2 = await newExp({ amount: 200_000, expenseTypeId: luong.id, note: "Lương thợ" });
    const aug = await tx((t) => createExpense(t, kt, body({ amount: 500_000, date: "2026-08-20" }), NOW));
    const dead = await newExp({ amount: 999_000 }); await tx((t) => cancelVoucher(t, kt, "PAYMENT", dead.paymentId, "sai", NOW));
    await tx((t) => reviewVoucher(t, tq, "PAYMENT", sep2.paymentId));
    const all = await listExpenses(prisma, kt, P());
    expect(all.total).toBe(4); expect(all.summary.total).toBe("1500000"); expect(all.summary.count).toBe(3);
    expect(all.summary.byType.map((t) => [t.name, t.amount])).toEqual([["Điện", "1300000"], ["Lương", "200000"]]);
    expect(all.summary.byMonth.map((m) => [m.month, m.amount])).toEqual([["2026-09", "1000000"], ["2026-08", "500000"]]);
    expect((await listExpenses(prisma, kt, P({ type: String(luong.id) }))).rows.map((r) => r.id)).toEqual([sep2.id]);
    expect((await listExpenses(prisma, kt, P({ status: "CANCELLED" }))).rows.map((r) => r.id)).toEqual([dead.id]);
    expect((await listExpenses(prisma, kt, P({ status: "REVIEWED" }))).rows.map((r) => r.id)).toEqual([sep2.id]);
    expect((await listExpenses(prisma, kt, P({ q: "thợ" }))).rows.map((r) => r.id)).toEqual([sep2.id]);
    expect((await exportExpensesXlsx(prisma, kt, P())).byteLength).toBeGreaterThan(1000);
    await expect(listExpenses(prisma, { userId: 1, perms: new Set() }, P())).rejects.toMatchObject({ status: 403 });
    expect(sep.id).toBeGreaterThan(0); expect(aug.id).toBeGreaterThan(0);
  });
});
