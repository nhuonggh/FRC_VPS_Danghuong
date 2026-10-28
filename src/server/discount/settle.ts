import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { cancelVoucher, createPayment } from "@/server/cash/vouchers";
import { discountBalance, partnerBalance } from "@/server/debt/balance";
import { postPartnerLedger, removePartnerLedger } from "@/server/debt/ledger";
import { DomainError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { docTimestamp, PeriodClosedError } from "@/server/inventory";
import { assertDocDateInPeriod, getOpenPeriod } from "@/server/period/guard";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import type { SettleInput } from "./schemas";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const RECONCILED_MSG = "Phiếu tất toán đã được hậu kiểm nên không hủy được.";

/**
 * Tất toán chiết khấu tích lũy (D-37). Không vượt số dư chiết khấu còn lại; OFFSET không vượt công nợ phải thu hiện có
 * (phần dư trả bằng tiền mặt). CASH sinh phiếu chi TAT_TOAN_CK (sổ quỹ ra, chờ thủ quỹ kiểm); FORFEIT = chuyển vào lãi công ty
 * (chỉ hết số dư chiết khấu). `forfeitAmount` tạo thêm một phiếu FORFEIT cùng giao dịch. Mọi thứ cùng transaction,
 * khoá dòng khách để hai lần tất toán đồng thời không vượt số dư. Trả về phiếu CHÍNH (`forfeit` = phiếu chuyển lãi kèm theo).
 */
export async function settleDiscount(tx: Tx, actor: Actor, input: SettleInput, now: Date = new Date()): Promise<{ id: number; code: string; forfeit?: { id: number; code: string } }> {
  assertCan(actor.perms, "discount.settle");
  const period = await getOpenPeriod(tx);
  const at = docTimestamp(input.date, now);
  assertDocDateInPeriod(period, at);
  await tx.$queryRaw`SELECT id FROM partners WHERE id = ${input.partnerId} FOR UPDATE`;
  const partner = await tx.partner.findUnique({ where: { id: input.partnerId }, select: { isCustomer: true, mergedIntoId: true, isActive: true } });
  if (!partner || partner.mergedIntoId !== null) throw new DomainError("Không tìm thấy khách hàng.", 404);
  if (!partner.isCustomer) throw new DomainError("Chỉ tất toán chiết khấu cho khách hàng.", 400);
  const amount = D(input.amount);
  const forfeitAmount = D(input.forfeitAmount ?? 0);
  const left = await discountBalance(tx, input.partnerId);
  if (amount.plus(forfeitAmount).gt(left)) throw new DomainError(`Vượt số dư chiết khấu còn lại (${left.toFixed(0)}).`, 409, "DISCOUNT_EXCEEDS_BALANCE");
  if (input.method === "OFFSET") {
    const owed = (await partnerBalance(tx, input.partnerId)).balance;
    if (amount.gt(owed.gt(0) ? owed : D(0))) throw new DomainError(`Trừ vào công nợ không vượt số khách đang nợ (${owed.gt(0) ? owed.toFixed(0) : "0"}) — phần còn lại hãy chi tiền.`, 409, "OFFSET_EXCEEDS_DEBT");
  }
  const main = await createSettlement(tx, actor, { partnerId: input.partnerId, method: input.method, amount, input, periodId: period.id, at }, now);
  let forfeit: { id: number; code: string } | undefined;
  if (forfeitAmount.gt(0)) forfeit = await createSettlement(tx, actor, { partnerId: input.partnerId, method: "FORFEIT", amount: forfeitAmount, input, periodId: period.id, at }, now);
  return forfeit ? { ...main, forfeit } : main;
}

export async function createSettlement(tx: Tx, actor: Actor, v: { partnerId: number; method: SettleInput["method"]; amount: Prisma.Decimal; input: SettleInput; periodId: number; at: Date }, now: Date): Promise<{ id: number; code: string }> {
  const { input, method, amount, periodId, at } = v;
  const period = { id: periodId };
  const id = await nextDocId(tx, "discount_settlements");
  const code = formatDocCode("CK", id);
  let paymentId: number | null = null;
  if (method === "CASH") {
    const p = await createPayment(tx, actor, { kind: "TAT_TOAN_CK", partnerId: null, cashAccountId: input.cashAccountId!, amount: amount.toNumber(), date: input.date, note: `Tất toán chiết khấu ${code}${input.note ? ` — ${input.note}` : ""}` }, now);
    paymentId = p.id;
  }
  await tx.discountSettlement.create({ data: { id, code, periodId: period.id, partnerId: input.partnerId, method, amount, at, note: input.note || null, paymentId, createdBy: actor.userId } });
  await tx.discountLedger.create({ data: { periodId: period.id, partnerId: input.partnerId, amountOut: amount, settleMethod: method, docType: "DISCOUNT_SETTLE", docId: id, at, createdBy: actor.userId } });
  if (method === "OFFSET") await postPartnerLedger(tx, { periodId: period.id, partnerId: input.partnerId, side: "credit", amount, docType: "DISCOUNT_SETTLE", docId: id, at, createdBy: actor.userId });
  await writeAudit(tx, { userId: actor.userId, action: "discount.settle", entity: "DiscountSettlement", entityId: id, after: { code, partnerId: input.partnerId, method, amount: amount.toString() } });
  return { id, code };
}

async function loadSettlement(tx: Tx, id: number) {
  await tx.$queryRaw`SELECT id FROM discount_settlements WHERE id = ${id} FOR UPDATE`;
  const s = await tx.discountSettlement.findUnique({ where: { id }, include: { payment: { select: { reviewStatus: true } } } });
  if (!s) throw new DomainError("Không tìm thấy phiếu tất toán.", 404);
  return s;
}

/** Hủy phiếu tất toán CHƯA hậu kiểm: trả lại số dư chiết khấu, đảo công nợ (OFFSET) hoặc hủy phiếu chi (CASH, khi thủ quỹ chưa kiểm). */
export async function cancelSettlement(tx: Tx, actor: Actor, id: number, reason: string, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "discount.settle");
  const s = await loadSettlement(tx, id);
  if (s.isCancelled) throw new DomainError("Phiếu tất toán đã hủy trước đó.", 409);
  const period = await getOpenPeriod(tx);
  if (s.periodId !== period.id) throw new PeriodClosedError();
  const row = await tx.discountLedger.findFirst({ where: { docType: "DISCOUNT_SETTLE", docId: id }, select: { isReconciled: true } });
  if (row?.isReconciled) throw new DomainError(RECONCILED_MSG, 409, "SETTLEMENT_RECONCILED");
  if (s.paymentId !== null && s.payment?.reviewStatus === "REVIEWED") throw new DomainError("Phiếu chi tiền đã được thủ quỹ kiểm tra — không hủy tất toán trực tiếp được.", 409, "VOUCHER_REVIEWED");
  await tx.$queryRaw`SELECT id FROM partners WHERE id = ${s.partnerId} FOR UPDATE`;
  await tx.discountLedger.deleteMany({ where: { docType: "DISCOUNT_SETTLE", docId: id } });
  await removePartnerLedger(tx, "DISCOUNT_SETTLE", id);
  if (s.paymentId !== null) await cancelVoucher(tx, actor, "PAYMENT", s.paymentId, `Hủy tất toán chiết khấu ${s.code}: ${reason}`, now);
  await tx.discountSettlement.update({ where: { id }, data: { isCancelled: true, cancelledAt: now, cancelledBy: actor.userId, cancelReason: reason } });
  await writeAudit(tx, { userId: actor.userId, action: "discount.settle.cancel", entity: "DiscountSettlement", entityId: id, before: { code: s.code, amount: s.amount.toString() }, after: { isCancelled: true, reason } });
}

/** Hậu kiểm tất toán (quyền discount.reconcile): khoá phiếu — không hủy/sửa được nữa. Hai người cùng bấm: một bên thắng. */
export async function reconcileSettlement(tx: Tx, actor: Actor, id: number, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "discount.reconcile");
  const s = await loadSettlement(tx, id);
  if (s.isCancelled) throw new DomainError("Phiếu tất toán đã hủy.", 409);
  const row = await tx.discountLedger.findFirst({ where: { docType: "DISCOUNT_SETTLE", docId: id }, select: { id: true, isReconciled: true } });
  if (!row) throw new DomainError("Không tìm thấy dòng sổ chiết khấu của phiếu.", 409);
  if (row.isReconciled) throw new DomainError("Phiếu đã được hậu kiểm trước đó.", 409, "ALREADY_RECONCILED");
  await tx.discountLedger.update({ where: { id: row.id }, data: { isReconciled: true, reconciledBy: actor.userId, reconciledAt: now } });
  await writeAudit(tx, { userId: actor.userId, action: "discount.reconcile", entity: "DiscountSettlement", entityId: id, after: { code: s.code } });
}

const idem = <R,>(prisma: PrismaClient, actor: Actor, scope: string, key: string, run: (tx: Tx) => Promise<R>) => withIdempotency(prisma, { userId: actor.userId, scope, key }, run);
export const settleDiscountIdempotent = (p: PrismaClient, a: Actor, key: string, i: SettleInput) => { assertCan(a.perms, "discount.settle"); return idem(p, a, "discount.settle", key, (tx) => settleDiscount(tx, a, i)); };
export const cancelSettlementIdempotent = (p: PrismaClient, a: Actor, key: string, id: number, reason: string) => { assertCan(a.perms, "discount.settle"); return idem(p, a, "discount.settle.cancel", key, async (tx) => { await cancelSettlement(tx, a, id, reason); return { id }; }); };
export const reconcileSettlementIdempotent = (p: PrismaClient, a: Actor, key: string, id: number) => { assertCan(a.perms, "discount.reconcile"); return idem(p, a, "discount.reconcile", key, async (tx) => { await reconcileSettlement(tx, a, id); return { id }; }); };
