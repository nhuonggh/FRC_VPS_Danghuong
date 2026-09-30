import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { postPartnerLedger } from "@/server/debt/ledger";
import { syncPaymentStatus } from "@/server/deposits/status";
import { DomainError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { PeriodClosedError } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";
import { postCashLedger } from "./ledger";
import type { AdjustmentRequestInput, VoucherDoc } from "./schemas";
import { lockVoucher, TRIP_VOUCHER_MSG, updateVoucher } from "./vouchers";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const entity = (doc: VoucherDoc) => (doc === "RECEIPT" ? "Receipt" : "Payment");

/** Yêu cầu điều chỉnh phiếu đã REVIEWED (D-33): lý do bắt buộc; mỗi phiếu chỉ một yêu cầu đang chờ. */
export async function requestAdjustment(tx: Tx, actor: Actor, doc: VoucherDoc, id: number, input: AdjustmentRequestInput): Promise<{ id: number }> {
  assertCan(actor.perms, "cash.adjust.request");
  const v = await lockVoucher(tx, doc, id);
  if (v.isCancelled) throw new DomainError("Phiếu đã hủy.", 409);
  if (v.reviewStatus !== "REVIEWED") throw new DomainError("Phiếu chưa kiểm tra — sửa/hủy trực tiếp thay vì điều chỉnh.", 409);
  const period = await getOpenPeriod(tx);
  if (v.periodId !== period.id) throw new PeriodClosedError();
  if (v.tripId !== null) throw new DomainError(TRIP_VOUCHER_MSG, 409, "TRIP_VOUCHER");
  if (v.type === "TAT_TOAN_CK") throw new DomainError("Phiếu chi tất toán chiết khấu không điều chỉnh trực tiếp — xử lý ở màn Chiết khấu tích lũy hoặc lập điều chỉnh công nợ.", 409);
  if (v.type === "COC" && input.kind === "AMOUNT") throw new DomainError("Phiếu cọc chỉ hủy được (đổi số tiền: hủy và lập lại).", 409);
  if (input.kind === "AMOUNT") {
    if (input.newCashAccountId !== null) {
      const a = await tx.cashAccount.findUnique({ where: { id: input.newCashAccountId }, select: { isActive: true } });
      if (!a || !a.isActive) throw new DomainError("Quỹ/tài khoản mới không hợp lệ hoặc đã tắt.", 400);
    }
    const sameAmount = input.newAmount === null || v.amount.equals(D(input.newAmount));
    const sameAccount = input.newCashAccountId === null || input.newCashAccountId === v.cashAccountId;
    if (sameAmount && sameAccount) throw new DomainError("Số liệu mới trùng phiếu hiện tại.", 400);
  }
  if ((await tx.cashAdjustment.count({ where: { docType: doc, docId: id, status: "REQUESTED" } })) > 0) throw new DomainError("Phiếu này đã có yêu cầu điều chỉnh đang chờ duyệt.", 409, "ADJUSTMENT_PENDING");
  const adj = await tx.cashAdjustment.create({
    data: { periodId: period.id, docType: doc, docId: id, kind: input.kind, reason: input.reason, newAmount: input.newAmount === null ? null : D(input.newAmount), newCashAccountId: input.newCashAccountId, oldAmount: v.amount, oldCashAccountId: v.cashAccountId, requestedBy: actor.userId },
    select: { id: true },
  });
  await writeAudit(tx, { userId: actor.userId, action: "cash.adjust.request", entity: entity(doc), entityId: id, after: { adjustmentId: adj.id, kind: input.kind, newAmount: input.newAmount, newCashAccountId: input.newCashAccountId, reason: input.reason } });
  return adj;
}

/**
 * Thủ quỹ duyệt / từ chối. Duyệt: KHÔNG sửa dòng sổ đã kiểm — thêm dòng ĐẢO (số/quỹ cũ) + dòng MỚI (docType CASH_ADJ,
 * docId = id yêu cầu) ở cả sổ quỹ lẫn công nợ, rồi cập nhật phiếu; VOID chỉ có dòng đảo và đánh dấu hủy.
 */
export async function decideAdjustment(tx: Tx, actor: Actor, adjustmentId: number, decision: { approve: boolean; note: string }, now: Date = new Date()): Promise<{ id: number; status: "APPROVED" | "REJECTED" }> {
  assertCan(actor.perms, "cash.adjust.approve");
  await tx.$queryRaw`SELECT id FROM cash_adjustments WHERE id = ${adjustmentId} FOR UPDATE`;
  const adj = await tx.cashAdjustment.findUnique({ where: { id: adjustmentId } });
  if (!adj) throw new DomainError("Không tìm thấy yêu cầu điều chỉnh.", 404);
  if (adj.status !== "REQUESTED") throw new DomainError("Yêu cầu này đã được xử lý.", 409, "ALREADY_DECIDED");
  const doc = adj.docType as VoucherDoc;
  const v = await lockVoucher(tx, doc, adj.docId);
  if (!decision.approve) {
    await tx.cashAdjustment.update({ where: { id: adj.id }, data: { status: "REJECTED", decidedBy: actor.userId, decidedAt: now, decisionNote: decision.note || null } });
    await writeAudit(tx, { userId: actor.userId, action: "cash.adjust.reject", entity: entity(doc), entityId: v.id, after: { adjustmentId: adj.id, note: decision.note } });
    return { id: adj.id, status: "REJECTED" };
  }
  if (v.isCancelled || v.reviewStatus !== "REVIEWED") throw new DomainError("Phiếu đã thay đổi, không áp dụng điều chỉnh này được.", 409);
  const period = await getOpenPeriod(tx);
  if (v.periodId !== period.id) throw new PeriodClosedError();

  const receipt = doc === "RECEIPT";
  const cashSideOld: "in" | "out" = receipt ? "out" : "in"; // đảo dòng gốc
  const cashSideNew: "in" | "out" = receipt ? "in" : "out";
  const partnerSideOld: "debit" | "credit" = receipt ? "debit" : "credit";
  const partnerSideNew: "debit" | "credit" = receipt ? "credit" : "debit";
  const base = { periodId: period.id, docType: "CASH_ADJ" as const, docId: adj.id, at: now, createdBy: actor.userId };
  await postCashLedger(tx, { ...base, cashAccountId: v.cashAccountId, side: cashSideOld, amount: v.amount });
  if (v.partnerId !== null) await postPartnerLedger(tx, { ...base, partnerId: v.partnerId, side: partnerSideOld, amount: v.amount });

  if (adj.kind === "VOID") {
    await updateVoucher(tx, doc, v.id, { isCancelled: true, cancelledAt: now, cancelledBy: actor.userId });
  } else {
    const newAmount = adj.newAmount ?? v.amount;
    const newAccount = adj.newCashAccountId ?? v.cashAccountId;
    await postCashLedger(tx, { ...base, cashAccountId: newAccount, side: cashSideNew, amount: newAmount });
    if (v.partnerId !== null) await postPartnerLedger(tx, { ...base, partnerId: v.partnerId, side: partnerSideNew, amount: newAmount });
    await updateVoucher(tx, doc, v.id, { amount: newAmount, cashAccountId: newAccount });
  }
  await tx.cashAdjustment.update({ where: { id: adj.id }, data: { status: "APPROVED", decidedBy: actor.userId, decidedAt: now, decisionNote: decision.note || null, oldAmount: v.amount, oldCashAccountId: v.cashAccountId } });
  if (v.orderId !== null) {
    await tx.$queryRaw`SELECT id FROM sale_orders WHERE id = ${v.orderId} FOR UPDATE`;
    await syncPaymentStatus(tx, v.orderId);
  }
  await writeAudit(tx, { userId: actor.userId, action: "cash.adjust.approve", entity: entity(doc), entityId: v.id, before: { amount: v.amount.toString(), cashAccountId: v.cashAccountId, isCancelled: false }, after: { adjustmentId: adj.id, kind: adj.kind, newAmount: adj.newAmount?.toString() ?? null, newCashAccountId: adj.newCashAccountId } });
  return { id: adj.id, status: "APPROVED" };
}

const idem = <R,>(prisma: PrismaClient, actor: Actor, scope: string, key: string, run: (tx: Tx) => Promise<R>) => withIdempotency(prisma, { userId: actor.userId, scope, key }, run);
export const requestAdjustmentIdempotent = (p: PrismaClient, a: Actor, key: string, doc: VoucherDoc, id: number, i: AdjustmentRequestInput) => { assertCan(a.perms, "cash.adjust.request"); return idem(p, a, `cash.adjust.request.${doc}`, key, (tx) => requestAdjustment(tx, a, doc, id, i)); };
export const decideAdjustmentIdempotent = (p: PrismaClient, a: Actor, key: string, id: number, d: { approve: boolean; note: string }) => { assertCan(a.perms, "cash.adjust.approve"); return idem(p, a, "cash.adjust.decide", key, (tx) => decideAdjustment(tx, a, id, d)); };
