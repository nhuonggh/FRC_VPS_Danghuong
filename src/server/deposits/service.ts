import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { lockOrderForDelivery } from "@/server/delivery/service";
import { DomainError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { docTimestamp, PeriodClosedError } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import type { DepositInput } from "./schemas";
import { syncPaymentStatus } from "./status";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/**
 * Thu tiền cọc (mục 36): phiếu thu loại COC gắn đơn. Tiền vào là `credit` của khách ngay lúc thu; khi giao hàng
 * (`debit`) số dư tự bù trừ — không cần bước "trừ cọc" riêng. Sổ quỹ (`cash_ledger`) thuộc plan 05-D1: khi đó sẽ dựng
 * từ bảng receipts, nên `cashAccountId` được bắt buộc ngay từ bây giờ.
 */
export async function createDeposit(tx: Tx, actor: Actor, input: DepositInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertCan(actor.perms, "deposit.manage");
  const { order, period } = await lockOrderForDelivery(tx, actor, input.orderId);
  if (order.isCancelled) throw new DomainError("Đơn đã hủy, không thu cọc được.", 409);
  const account = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId }, select: { isActive: true } });
  if (!account || !account.isActive) throw new DomainError("Quỹ/tài khoản nhận tiền không hợp lệ.", 400);
  const at = docTimestamp(input.date, now);

  const id = await nextDocId(tx, "receipts");
  const code = formatDocCode("PT", id);
  await tx.receipt.create({
    data: { id, code, periodId: period.id, partnerId: order.partnerId, type: "COC", orderId: order.id, amount: D(input.amount), cashAccountId: input.cashAccountId, at, note: input.note || null, createdBy: actor.userId },
  });
  await tx.partnerLedger.create({ data: { periodId: period.id, partnerId: order.partnerId, credit: D(input.amount), docType: "RECEIPT", docId: id, at, createdBy: actor.userId } });
  await syncPaymentStatus(tx, order.id);
  await writeAudit(tx, { userId: actor.userId, action: "deposit.create", entity: "Receipt", entityId: id, after: { code, orderCode: order.code, type: "COC" } });
  return { id, code };
}

export const createDepositIdempotent = (prisma: PrismaClient, actor: Actor, key: string, input: DepositInput) => {
  assertCan(actor.perms, "deposit.manage");
  return withIdempotency(prisma, { userId: actor.userId, scope: "deposit.create", key }, (tx) => createDeposit(tx, actor, input));
};

async function loadDeposit(tx: Tx, actor: Actor, id: number) {
  const r = await tx.receipt.findFirst({ where: { id, type: "COC", partner: partnerScopeWhere(actor) } });
  if (!r) throw new DomainError("Không tìm thấy phiếu cọc.", 404);
  return r;
}

/**
 * Chuyển cọc thành SỐ DƯ của khách (bỏ liên kết với đơn): dùng khi cần hủy đơn đang có cọc (34b). Tiền vẫn nằm ở
 * công nợ của khách (credit) nên không mất; hoàn tiền mặt bằng phiếu chi thuộc plan 05.
 */
export async function releaseDeposit(tx: Tx, actor: Actor, id: number): Promise<void> {
  assertCan(actor.perms, "deposit.manage");
  const r = await loadDeposit(tx, actor, id);
  if (r.isCancelled) throw new DomainError("Phiếu cọc đã hủy.", 409);
  if (r.orderId === null) throw new DomainError("Cọc này đã được chuyển thành số dư của khách.", 409);
  const period = await getOpenPeriod(tx);
  if (r.periodId !== period.id) throw new PeriodClosedError();
  await tx.$queryRaw`SELECT id FROM sale_orders WHERE id = ${r.orderId} FOR UPDATE`;
  await tx.receipt.update({ where: { id }, data: { orderId: null } });
  await syncPaymentStatus(tx, r.orderId);
  await writeAudit(tx, { userId: actor.userId, action: "deposit.release", entity: "Receipt", entityId: id, before: { orderId: r.orderId }, after: { orderId: null } });
}

/** Hủy phiếu cọc (nhập nhầm): đảo công nợ (xoá dòng sổ của phiếu, như các chứng từ khác) và tính lại trạng thái thanh toán. */
export async function cancelDeposit(tx: Tx, actor: Actor, id: number, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "deposit.manage");
  const r = await loadDeposit(tx, actor, id);
  if (r.isCancelled) throw new DomainError("Phiếu cọc đã hủy trước đó.", 409);
  const period = await getOpenPeriod(tx);
  if (r.periodId !== period.id) throw new PeriodClosedError();
  if (r.orderId !== null) await tx.$queryRaw`SELECT id FROM sale_orders WHERE id = ${r.orderId} FOR UPDATE`;
  await tx.receipt.update({ where: { id }, data: { isCancelled: true, cancelledAt: now, cancelledBy: actor.userId } });
  await tx.partnerLedger.deleteMany({ where: { docType: "RECEIPT", docId: id } });
  if (r.orderId !== null) await syncPaymentStatus(tx, r.orderId);
  await writeAudit(tx, { userId: actor.userId, action: "deposit.cancel", entity: "Receipt", entityId: id, before: { code: r.code }, after: { isCancelled: true } });
}
