import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { docTimestamp } from "@/server/inventory";
import { assertDocDateInPeriod, getOpenPeriod } from "@/server/period/guard";
import { z } from "zod";
import { addReviewEvent, lockVoucher, postVoucherLedgers, removeVoucherLedgers, updateVoucher, createPayment } from "./vouchers";

type Tx = Prisma.TransactionClient;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.");
export const expenseSchema = z.object({
  expenseTypeId: z.number({ invalid_type_error: "Chọn loại chi phí." }).int().positive("Chọn loại chi phí."),
  cashAccountId: z.number({ invalid_type_error: "Chọn quỹ/tài khoản." }).int().positive("Chọn quỹ/tài khoản."),
  amount: z.number({ invalid_type_error: "Nhập số tiền." }).finite().gt(0, "Số tiền phải lớn hơn 0.").max(99_999_999_999).refine((v) => Number(v.toFixed(2)) === v, "Tối đa 2 chữ số thập phân."),
  date: ymd,
  note: z.string().trim().max(300, "Ghi chú tối đa 300 ký tự."),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

async function checkType(tx: Tx, id: number) {
  const t = await tx.expenseType.findUnique({ where: { id }, select: { isActive: true } });
  if (!t || !t.isActive) throw new DomainError("Loại chi phí không hợp lệ hoặc đã tắt.", 400);
}

/** Lập chi phí (66): một phiếu chi loại CHI_PHI + dòng loại chi phí. Sổ quỹ ra, KHÔNG đụng công nợ; thủ quỹ hậu kiểm như mọi phiếu chi. */
export async function createExpense(tx: Tx, actor: Actor, input: ExpenseInput, now: Date = new Date()): Promise<{ id: number; paymentId: number; code: string }> {
  assertCan(actor.perms, "expense.manage");
  await checkType(tx, input.expenseTypeId);
  const p = await createPayment(tx, actor, { kind: "CHI_PHI", partnerId: null, cashAccountId: input.cashAccountId, amount: input.amount, date: input.date, note: input.note }, now);
  const period = await getOpenPeriod(tx);
  const e = await tx.operatingExpense.create({ data: { periodId: period.id, expenseTypeId: input.expenseTypeId, paymentId: p.id, createdBy: actor.userId }, select: { id: true } });
  await writeAudit(tx, { userId: actor.userId, action: "expense.create", entity: "OperatingExpense", entityId: e.id, after: { code: p.code, expenseTypeId: input.expenseTypeId, amount: input.amount } });
  return { id: e.id, paymentId: p.id, code: p.code };
}

/** Sửa chi phí khi phiếu chi CHƯA kiểm tra (hoặc bị trả lại): gỡ & ghi lại sổ quỹ. */
export async function editExpense(tx: Tx, actor: Actor, id: number, input: ExpenseInput, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "expense.manage");
  assertCan(actor.perms, "cash.transaction.edit_pending");
  const ex = await tx.operatingExpense.findUnique({ where: { id }, select: { paymentId: true, expenseTypeId: true } });
  if (!ex) throw new DomainError("Không tìm thấy khoản chi phí.", 404);
  const v = await lockVoucher(tx, "PAYMENT", ex.paymentId);
  if (v.isCancelled) throw new DomainError("Phiếu chi đã hủy.", 409);
  if (v.reviewStatus === "REVIEWED") throw new DomainError("Phiếu đã được thủ quỹ kiểm tra nên không sửa trực tiếp — hãy yêu cầu điều chỉnh.", 409, "VOUCHER_REVIEWED");
  const period = await getOpenPeriod(tx);
  if (v.periodId !== period.id) throw new DomainError("Kỳ đã đóng.", 409);
  await checkType(tx, input.expenseTypeId);
  const acc = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId }, select: { isActive: true } });
  if (!acc || !acc.isActive) throw new DomainError("Quỹ/tài khoản không hợp lệ hoặc đã tắt.", 400);
  const t = new Date(v.at.getTime() + 7 * 3600_000); const same = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}` === input.date;
  const at = same ? v.at : docTimestamp(input.date, now);
  assertDocDateInPeriod(period, at);
  await removeVoucherLedgers(tx, "PAYMENT", v.id);
  const amount = new Prisma.Decimal(input.amount);
  await updateVoucher(tx, "PAYMENT", v.id, { amount, cashAccountId: input.cashAccountId, at, note: input.note || null });
  await postVoucherLedgers(tx, { doc: "PAYMENT", id: v.id, periodId: v.periodId, type: "CHI_PHI", partnerId: null, cashAccountId: input.cashAccountId, amount, at }, actor.userId);
  await tx.operatingExpense.update({ where: { id }, data: { expenseTypeId: input.expenseTypeId } });
  await addReviewEvent(tx, "PAYMENT", v.id, v.reviewStatus === "RETURNED" ? "RESUBMIT" : "EDIT", actor.userId);
  if (v.reviewStatus === "RETURNED") await updateVoucher(tx, "PAYMENT", v.id, { reviewStatus: "PENDING_REVIEW", reviewedBy: null, reviewedAt: null });
  await writeAudit(tx, { userId: actor.userId, action: "expense.update", entity: "OperatingExpense", entityId: id, before: { amount: v.amount.toString(), expenseTypeId: ex.expenseTypeId, cashAccountId: v.cashAccountId }, after: { amount: input.amount, expenseTypeId: input.expenseTypeId, cashAccountId: input.cashAccountId } });
}

const idem = <R,>(prisma: PrismaClient, actor: Actor, scope: string, key: string, run: (tx: Tx) => Promise<R>) => withIdempotency(prisma, { userId: actor.userId, scope, key }, run);
export const createExpenseIdempotent = (p: PrismaClient, a: Actor, key: string, i: ExpenseInput) => { assertCan(a.perms, "expense.manage"); return idem(p, a, "expense.create", key, (tx) => createExpense(tx, a, i)); };
