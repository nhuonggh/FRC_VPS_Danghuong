import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { assertPeriodOpen, getOpenPeriod } from "@/server/period/guard";
import { formatCurrency } from "@/lib/format";
import { ictYmd } from "@/lib/time";
import { cashBalance } from "./balance";
import type { CashCloseInput } from "./schemas";
import { createPayment } from "./vouchers";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * Chốt quỹ (D-33/mặc định 2–3): thủ quỹ tự chọn mốc; hệ thống tính tồn đầu + thu − chi đến mốc, so với tiền kiểm đếm.
 * Có chênh lệch ⇒ lý do bắt buộc (vẫn cho chốt). Lưu snapshot; KHÔNG khoá chứng từ và không thay `period.close`.
 */
export async function createCashClose(tx: Tx, actor: Actor, input: CashCloseInput, now: Date = new Date()): Promise<{ id: number; expected: string; diff: string }> {
  assertCan(actor.perms, "cash.close");
  const period = await getOpenPeriod(tx);
  const account = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId }, select: { isActive: true } });
  if (!account || !account.isActive) throw new DomainError("Quỹ/tài khoản không hợp lệ hoặc đã tắt.", 400);
  const closeAt = new Date(input.closeAt);
  if (closeAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) throw new DomainError("Mốc chốt không được ở tương lai.", 400);
  if (closeAt < period.openedAt) throw new DomainError("Mốc chốt trước ngày mở kỳ.", 400);
  // Khoá dòng tài khoản để hai lần chốt cùng lúc tuần tự (số dư đọc sau khi lần trước xong)
  await tx.$queryRaw`SELECT id FROM cash_accounts WHERE id = ${input.cashAccountId} FOR UPDATE`;
  const expected = (await cashBalance(tx, period.id, input.cashAccountId, closeAt)).balance;
  const actual = D(input.actual);
  const diff = actual.minus(expected);
  // Nhận lại tiền = chi đúng số kiểm đếm; lớn hơn số dư sổ sẽ làm quỹ âm (vd kế toán đã nộp lại quỹ trước đó).
  if (input.handOver && actual.gt(expected)) throw new DomainError(`Số kiểm đếm (${formatCurrency(actual.toString())}) lớn hơn số dư sổ (${formatCurrency(expected.toString())}) nên không thể "Giám đốc nhận lại". Kiểm tra phiếu nộp lại quỹ đã lập hoặc xử lý chênh lệch trước.`, 400, "HANDOVER_EXCEEDS_BALANCE");
  if (!diff.isZero() && !input.reason) throw new DomainError("Có chênh lệch giữa sổ và tiền kiểm đếm — nhập lý do.", 400, "DIFF_REASON_REQUIRED");
  const row = await tx.cashClose.create({
    data: { periodId: period.id, cashAccountId: input.cashAccountId, closeAt, expected, actual, diff, reason: input.reason || null, createdBy: actor.userId },
    select: { id: true },
  });
  await writeAudit(tx, { userId: actor.userId, action: "cash.close", entity: "CashClose", entityId: row.id, after: { cashAccountId: input.cashAccountId, closeAt: closeAt.toISOString(), expected: expected.toString(), actual: actual.toString(), diff: diff.toString(), reason: input.reason } });
  // Giám đốc nhận lại toàn bộ tiền kiểm đếm: phiếu chi lập SAU khi đã tính số sổ, cùng giao dịch với lần chốt.
  if (input.handOver && actual.gt(0)) {
    await createPayment(tx, actor, { kind: "NOP_LAI_QUY", partnerId: null, advancedById: null, cashAccountId: input.cashAccountId, amount: actual.toNumber(), date: ictYmd(closeAt), note: "Giám đốc nhận lại tiền quỹ khi chốt" }, now);
  }
  return { id: row.id, expected: expected.toString(), diff: diff.toString() };
}

/** Hủy một lần chốt (quyền riêng `cash.close.reopen`, lý do bắt buộc) — giữ dòng, đánh dấu vô hiệu. */
export async function voidCashClose(tx: Tx, actor: Actor, id: number, reason: string, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "cash.close.reopen");
  await tx.$queryRaw`SELECT id FROM cash_closes WHERE id = ${id} FOR UPDATE`;
  const c = await tx.cashClose.findUnique({ where: { id }, select: { voidedAt: true, periodId: true } });
  if (!c) throw new DomainError("Không tìm thấy lần chốt quỹ.", 404);
  await assertPeriodOpen(tx, c.periodId); // lần chốt của kỳ đã kết sổ là bất biến (spec 4.4)
  if (c.voidedAt) throw new DomainError("Lần chốt này đã hủy trước đó.", 409);
  await tx.cashClose.update({ where: { id }, data: { voidedAt: now, voidedBy: actor.userId, voidReason: reason } });
  await writeAudit(tx, { userId: actor.userId, action: "cash.close.void", entity: "CashClose", entityId: id, after: { reason } });
}

const idem = <R,>(prisma: PrismaClient, actor: Actor, scope: string, key: string, run: (tx: Tx) => Promise<R>) => withIdempotency(prisma, { userId: actor.userId, scope, key }, run);
export const createCashCloseIdempotent = (p: PrismaClient, a: Actor, key: string, i: CashCloseInput) => { assertCan(a.perms, "cash.close"); return idem(p, a, "cash.close", key, (tx) => createCashClose(tx, a, i)); };
export const voidCashCloseIdempotent = (p: PrismaClient, a: Actor, key: string, id: number, reason: string) => { assertCan(a.perms, "cash.close.reopen"); return idem(p, a, "cash.close.void", key, async (tx) => { await voidCashClose(tx, a, id, reason); return { id }; }); };
