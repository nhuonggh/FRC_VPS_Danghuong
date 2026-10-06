import { Prisma, type CashReviewStatus, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { toIct } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import { postPartnerLedger, removePartnerLedger } from "@/server/debt/ledger";
import { syncPaymentStatus } from "@/server/deposits/status";
import { DomainError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { docTimestamp, PeriodClosedError } from "@/server/inventory";
import { assertDocDateInPeriod, assertPeriodOpen, getOpenPeriod } from "@/server/period/guard";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import { postCashLedger, removeCashLedger } from "./ledger";
import type { PaymentInput, ReceiptInput, VoucherDoc } from "./schemas";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const VOUCHER_PREFIX: Record<VoucherDoc, string> = { RECEIPT: "PT", PAYMENT: "PC" };
export const TRIP_VOUCHER_MSG = "Phiếu thu này sinh từ chuyến giao (thủ quỹ đã xác nhận nhận tiền) nên không sửa/hủy trực tiếp.";
export const REVIEWED_MSG = "Phiếu đã được thủ quỹ kiểm tra nên không sửa/hủy trực tiếp — hãy yêu cầu điều chỉnh.";

/** Dạng chung của phiếu thu/chi để dùng chung luồng lập/sửa/hủy/kiểm tra/điều chỉnh. */
export interface Voucher {
  id: number; doc: VoucherDoc; periodId: number; code: string; type: string; partnerId: number | null; orderId: number | null;
  cashAccountId: number; amount: Prisma.Decimal; at: Date; note: string | null;
  reviewStatus: CashReviewStatus; isCancelled: boolean; createdBy: number;
  /** Phiếu thu sinh từ xác nhận chuyến giao (công nợ đã ghi ở TRIP_COLLECT) — chỉ đổi qua nghiệp vụ chuyến. */
  tripId: number | null;
}

/** Khoá dòng phiếu (`FOR UPDATE`) rồi đọc: hai thủ quỹ kiểm cùng phiếu / sửa & kiểm đồng thời chỉ một bên thắng. */
export async function lockVoucher(tx: Tx, doc: VoucherDoc, id: number): Promise<Voucher> {
  if (doc === "RECEIPT") {
    await tx.$queryRaw`SELECT id FROM receipts WHERE id = ${id} FOR UPDATE`;
    const r = await tx.receipt.findUnique({ where: { id } });
    if (!r) throw new DomainError("Không tìm thấy phiếu thu.", 404);
    return { id, doc, periodId: r.periodId, code: r.code, type: r.type, partnerId: r.partnerId, orderId: r.orderId, cashAccountId: r.cashAccountId, amount: r.amount, at: r.at, note: r.note, reviewStatus: r.reviewStatus, isCancelled: r.isCancelled, createdBy: r.createdBy, tripId: r.tripId };
  }
  await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id} FOR UPDATE`;
  const p = await tx.payment.findUnique({ where: { id } });
  if (!p) throw new DomainError("Không tìm thấy phiếu chi.", 404);
  return { id, doc, periodId: p.periodId, code: p.code, type: p.kind, partnerId: p.partnerId, orderId: null, cashAccountId: p.cashAccountId, amount: p.amount, at: p.at, note: p.note, reviewStatus: p.reviewStatus, isCancelled: p.isCancelled, createdBy: p.createdBy, tripId: null };
}

type VoucherPatch = Partial<{ amount: Prisma.Decimal; cashAccountId: number; at: Date; note: string | null; partnerId: number | null; orderId: number | null; reviewStatus: CashReviewStatus; reviewedBy: number | null; reviewedAt: Date | null; isCancelled: boolean; cancelledAt: Date | null; cancelledBy: number | null }>;
export async function updateVoucher(tx: Tx, doc: VoucherDoc, id: number, patch: VoucherPatch): Promise<void> {
  if (doc === "RECEIPT") await tx.receipt.update({ where: { id }, data: patch });
  else { const { orderId: _ignored, ...rest } = patch; void _ignored; await tx.payment.update({ where: { id }, data: rest }); }
}

/** Sổ quỹ + sổ công nợ của phiếu (cùng transaction với chứng từ). */
export async function postVoucherLedgers(tx: Tx, v: Pick<Voucher, "doc" | "id" | "periodId" | "type" | "partnerId" | "cashAccountId" | "amount" | "at">, userId: number): Promise<void> {
  const common = { periodId: v.periodId, cashAccountId: v.cashAccountId, amount: v.amount, docType: v.doc, docId: v.id, at: v.at, createdBy: userId } as const;
  if (v.doc === "RECEIPT") {
    await postCashLedger(tx, { ...common, side: "in" });
    if (v.partnerId !== null) await postPartnerLedger(tx, { periodId: v.periodId, partnerId: v.partnerId, side: "credit", amount: v.amount, docType: "RECEIPT", docId: v.id, at: v.at, createdBy: userId });
  } else {
    await postCashLedger(tx, { ...common, side: "out" });
    if (v.partnerId !== null) await postPartnerLedger(tx, { periodId: v.periodId, partnerId: v.partnerId, side: "debit", amount: v.amount, docType: "PAYMENT", docId: v.id, at: v.at, createdBy: userId });
  }
}
export async function removeVoucherLedgers(tx: Tx, doc: VoucherDoc, id: number): Promise<void> {
  await removeCashLedger(tx, doc, id);
  await removePartnerLedger(tx, doc, id);
}

export async function addReviewEvent(tx: Tx, doc: VoucherDoc, id: number, action: "SUBMIT" | "EDIT" | "RESUBMIT" | "REVIEW" | "RETURN" | "CANCEL", userId: number, reason?: string | null) {
  await tx.cashReviewEvent.create({ data: { docType: doc, docId: id, action, reason: reason || null, userId } });
}

const managePerm = (doc: VoucherDoc, type?: string) => (doc === "RECEIPT" ? "receipt.manage" : type === "CHI_PHI" ? "expense.manage" : type === "TAT_TOAN_CK" ? "discount.settle" : "payment.manage");
function assertVoucherPerm(actor: Actor, doc: VoucherDoc, action: "create" | "edit", type?: string) {
  assertCan(actor.perms, managePerm(doc, type));
  assertCan(actor.perms, action === "create" ? "cash.transaction.create" : "cash.transaction.edit_pending");
}

async function checkAccount(tx: Tx, id: number) {
  const a = await tx.cashAccount.findUnique({ where: { id }, select: { isActive: true } });
  if (!a || !a.isActive) throw new DomainError("Quỹ/tài khoản không hợp lệ hoặc đã tắt.", 400);
}
async function checkPartner(tx: Tx, id: number, role: "customer" | "supplier" | "any") {
  const p = await tx.partner.findUnique({ where: { id }, select: { isCustomer: true, isSupplier: true, mergedIntoId: true, isActive: true } });
  if (!p || p.mergedIntoId !== null) throw new DomainError("Không tìm thấy đối tác.", 404);
  if (!p.isActive) throw new DomainError("Đối tác đã tắt.", 409);
  if (role === "customer" && !p.isCustomer) throw new DomainError("Đối tác này không phải khách hàng.", 400);
  if (role === "supplier" && !p.isSupplier) throw new DomainError("Đối tác này không phải nhà cung cấp.", 400);
}
async function lockAndCheckOrder(tx: Tx, orderId: number, partnerId: number | null) {
  await tx.$queryRaw`SELECT id FROM sale_orders WHERE id = ${orderId} FOR UPDATE`;
  const o = await tx.saleOrder.findUnique({ where: { id: orderId }, select: { partnerId: true, isCancelled: true, isDraft: true } });
  if (!o) throw new DomainError("Không tìm thấy đơn hàng.", 404);
  if (o.isCancelled) throw new DomainError("Đơn đã hủy, không thu tiền theo đơn được.", 409);
  if (o.isDraft) throw new DomainError("Đơn nháp chưa xác nhận, không thu tiền theo đơn được.", 409);
  if (o.partnerId !== partnerId) throw new DomainError("Đơn không thuộc khách đã chọn.", 400);
}
const ymdOf = (d: Date) => { const t = toIct(d); return `${t.y}-${String(t.m + 1).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`; };

// ── lập ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function createReceipt(tx: Tx, actor: Actor, input: ReceiptInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertVoucherPerm(actor, "RECEIPT", "create");
  const period = await getOpenPeriod(tx);
  const at = docTimestamp(input.date, now);
  assertDocDateInPeriod(period, at);
  await checkAccount(tx, input.cashAccountId);
  if (input.partnerId !== null) await checkPartner(tx, input.partnerId, input.type === "THU_NO" ? "customer" : "any");
  if (input.orderId !== null) await lockAndCheckOrder(tx, input.orderId, input.partnerId);
  const id = await nextDocId(tx, "receipts");
  const code = formatDocCode(VOUCHER_PREFIX.RECEIPT, id);
  const amount = D(input.amount);
  await tx.receipt.create({ data: { id, code, periodId: period.id, partnerId: input.partnerId, type: input.type, orderId: input.orderId, amount, cashAccountId: input.cashAccountId, at, note: input.note || null, createdBy: actor.userId } });
  await postVoucherLedgers(tx, { doc: "RECEIPT", id, periodId: period.id, type: input.type, partnerId: input.partnerId, cashAccountId: input.cashAccountId, amount, at }, actor.userId);
  await addReviewEvent(tx, "RECEIPT", id, "SUBMIT", actor.userId);
  if (input.orderId !== null) await syncPaymentStatus(tx, input.orderId);
  await writeAudit(tx, { userId: actor.userId, action: "receipt.create", entity: "Receipt", entityId: id, after: { code, type: input.type, amount: input.amount, cashAccountId: input.cashAccountId } });
  return { id, code };
}

export async function createPayment(tx: Tx, actor: Actor, input: Omit<PaymentInput, "kind"> & { kind: PaymentInput["kind"] | "CHI_PHI" | "TAT_TOAN_CK"; goodsReturnId?: number | null }, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertVoucherPerm(actor, "PAYMENT", "create", input.kind);
  const period = await getOpenPeriod(tx);
  const at = docTimestamp(input.date, now);
  assertDocDateInPeriod(period, at);
  await checkAccount(tx, input.cashAccountId);
  if (input.partnerId !== null) await checkPartner(tx, input.partnerId, input.kind === "TRA_NCC" ? "supplier" : "customer");
  const id = await nextDocId(tx, "payments");
  const code = formatDocCode(VOUCHER_PREFIX.PAYMENT, id);
  const amount = D(input.amount);
  await tx.payment.create({ data: { id, code, periodId: period.id, kind: input.kind, partnerId: input.partnerId, amount, cashAccountId: input.cashAccountId, at, note: input.note || null, goodsReturnId: input.goodsReturnId ?? null, createdBy: actor.userId } });
  await postVoucherLedgers(tx, { doc: "PAYMENT", id, periodId: period.id, type: input.kind, partnerId: input.partnerId, cashAccountId: input.cashAccountId, amount, at }, actor.userId);
  await addReviewEvent(tx, "PAYMENT", id, "SUBMIT", actor.userId);
  await writeAudit(tx, { userId: actor.userId, action: "payment.create", entity: "Payment", entityId: id, after: { code, kind: input.kind, amount: input.amount, cashAccountId: input.cashAccountId } });
  return { id, code };
}

// ── sửa / hủy khi CHƯA kiểm tra ──────────────────────────────────────────────────────────────────────────────────────
async function assertEditable(tx: Tx, v: Voucher) {
  if (v.isCancelled) throw new DomainError("Phiếu đã hủy.", 409);
  if (v.tripId !== null) throw new DomainError(TRIP_VOUCHER_MSG, 409, "TRIP_VOUCHER");
  if (v.reviewStatus === "REVIEWED") throw new DomainError(REVIEWED_MSG, 409, "VOUCHER_REVIEWED");
  const period = await getOpenPeriod(tx);
  if (v.periodId !== period.id) throw new PeriodClosedError();
  return period;
}

export async function editReceipt(tx: Tx, actor: Actor, id: number, input: ReceiptInput, now: Date = new Date()): Promise<void> {
  assertVoucherPerm(actor, "RECEIPT", "edit");
  const v = await lockVoucher(tx, "RECEIPT", id);
  if (v.type === "COC") throw new DomainError("Phiếu cọc sửa ở màn Tiền cọc của đơn hàng.", 409);
  if (input.type !== v.type) throw new DomainError("Không đổi loại phiếu thu được — hủy và lập phiếu mới.", 409);
  const period = await assertEditable(tx, v);
  const at = ymdOf(v.at) === input.date ? v.at : docTimestamp(input.date, now);
  assertDocDateInPeriod(period, at);
  await checkAccount(tx, input.cashAccountId);
  if (input.partnerId !== null) await checkPartner(tx, input.partnerId, input.type === "THU_NO" ? "customer" : "any");
  if (input.orderId !== null) await lockAndCheckOrder(tx, input.orderId, input.partnerId);
  await removeVoucherLedgers(tx, "RECEIPT", id);
  const amount = D(input.amount);
  await updateVoucher(tx, "RECEIPT", id, { amount, cashAccountId: input.cashAccountId, at, note: input.note || null, partnerId: input.partnerId, orderId: input.orderId });
  await postVoucherLedgers(tx, { doc: "RECEIPT", id, periodId: v.periodId, type: v.type, partnerId: input.partnerId, cashAccountId: input.cashAccountId, amount, at }, actor.userId);
  await addReviewEvent(tx, "RECEIPT", id, v.reviewStatus === "RETURNED" ? "RESUBMIT" : "EDIT", actor.userId);
  if (v.reviewStatus === "RETURNED") await updateVoucher(tx, "RECEIPT", id, { reviewStatus: "PENDING_REVIEW", reviewedBy: null, reviewedAt: null });
  for (const orderId of new Set([v.orderId, input.orderId])) if (orderId !== null) await syncPaymentStatus(tx, orderId);
  await writeAudit(tx, { userId: actor.userId, action: "receipt.update", entity: "Receipt", entityId: id, before: { amount: v.amount.toString(), cashAccountId: v.cashAccountId, partnerId: v.partnerId, orderId: v.orderId }, after: { amount: input.amount, cashAccountId: input.cashAccountId, partnerId: input.partnerId, orderId: input.orderId } });
}

export async function editPayment(tx: Tx, actor: Actor, id: number, input: PaymentInput, now: Date = new Date()): Promise<void> {
  assertVoucherPerm(actor, "PAYMENT", "edit");
  const v = await lockVoucher(tx, "PAYMENT", id);
  if (v.type === "CHI_PHI" || v.type === "TAT_TOAN_CK") throw new DomainError("Phiếu này sinh từ chi phí/tất toán chiết khấu — sửa ở màn tương ứng.", 409);
  if (input.kind !== v.type) throw new DomainError("Không đổi loại phiếu chi được — hủy và lập phiếu mới.", 409);
  const period = await assertEditable(tx, v);
  const at = ymdOf(v.at) === input.date ? v.at : docTimestamp(input.date, now);
  assertDocDateInPeriod(period, at);
  await checkAccount(tx, input.cashAccountId);
  if (input.partnerId !== null) await checkPartner(tx, input.partnerId, input.kind === "TRA_NCC" ? "supplier" : "customer");
  await removeVoucherLedgers(tx, "PAYMENT", id);
  const amount = D(input.amount);
  await updateVoucher(tx, "PAYMENT", id, { amount, cashAccountId: input.cashAccountId, at, note: input.note || null, partnerId: input.partnerId });
  await postVoucherLedgers(tx, { doc: "PAYMENT", id, periodId: v.periodId, type: v.type, partnerId: input.partnerId, cashAccountId: input.cashAccountId, amount, at }, actor.userId);
  await addReviewEvent(tx, "PAYMENT", id, v.reviewStatus === "RETURNED" ? "RESUBMIT" : "EDIT", actor.userId);
  if (v.reviewStatus === "RETURNED") await updateVoucher(tx, "PAYMENT", id, { reviewStatus: "PENDING_REVIEW", reviewedBy: null, reviewedAt: null });
  await writeAudit(tx, { userId: actor.userId, action: "payment.update", entity: "Payment", entityId: id, before: { amount: v.amount.toString(), cashAccountId: v.cashAccountId, partnerId: v.partnerId }, after: { amount: input.amount, cashAccountId: input.cashAccountId, partnerId: input.partnerId } });
}

/** Hủy phiếu CHƯA kiểm tra: gỡ sổ quỹ + công nợ (về 0). Phiếu đã REVIEWED phải qua điều chỉnh (VOID). */
export async function cancelVoucher(tx: Tx, actor: Actor, doc: VoucherDoc, id: number, reason: string, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "cash.transaction.edit_pending");
  const v = await lockVoucher(tx, doc, id);
  assertCan(actor.perms, managePerm(doc, v.type));
  await assertEditable(tx, v);
  if (v.orderId !== null) await tx.$queryRaw`SELECT id FROM sale_orders WHERE id = ${v.orderId} FOR UPDATE`;
  await removeVoucherLedgers(tx, doc, id);
  await updateVoucher(tx, doc, id, { isCancelled: true, cancelledAt: now, cancelledBy: actor.userId });
  await addReviewEvent(tx, doc, id, "CANCEL", actor.userId, reason);
  if (v.orderId !== null) await syncPaymentStatus(tx, v.orderId);
  await writeAudit(tx, { userId: actor.userId, action: doc === "RECEIPT" ? "receipt.cancel" : "payment.cancel", entity: doc === "RECEIPT" ? "Receipt" : "Payment", entityId: id, before: { code: v.code, amount: v.amount.toString() }, after: { isCancelled: true, reason } });
}

// ── hậu kiểm ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function reviewVoucher(tx: Tx, actor: Actor, doc: VoucherDoc, id: number, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "cash.review");
  const v = await lockVoucher(tx, doc, id);
  if (v.isCancelled) throw new DomainError("Phiếu đã hủy.", 409);
  if (v.reviewStatus === "REVIEWED") throw new DomainError("Phiếu đã được kiểm tra trước đó.", 409, "ALREADY_REVIEWED");
  if (v.reviewStatus === "RETURNED") throw new DomainError("Phiếu đang bị trả lại, chờ kế toán sửa và gửi lại.", 409);
  await updateVoucher(tx, doc, id, { reviewStatus: "REVIEWED", reviewedBy: actor.userId, reviewedAt: now });
  await addReviewEvent(tx, doc, id, "REVIEW", actor.userId);
  await writeAudit(tx, { userId: actor.userId, action: doc === "RECEIPT" ? "receipt.review" : "payment.review", entity: doc === "RECEIPT" ? "Receipt" : "Payment", entityId: id, before: { reviewStatus: v.reviewStatus }, after: { reviewStatus: "REVIEWED" } });
}

export async function returnVoucher(tx: Tx, actor: Actor, doc: VoucherDoc, id: number, reason: string): Promise<void> {
  assertCan(actor.perms, "cash.review");
  const v = await lockVoucher(tx, doc, id);
  if (v.isCancelled) throw new DomainError("Phiếu đã hủy.", 409);
  if (v.reviewStatus === "REVIEWED") throw new DomainError("Phiếu đã được kiểm tra — dùng điều chỉnh thay vì trả lại.", 409, "ALREADY_REVIEWED");
  if (v.reviewStatus === "RETURNED") throw new DomainError("Phiếu đã bị trả lại trước đó.", 409);
  // Phiếu kỳ đã kết sổ không sửa lại được → trả lại sẽ khiến phiếu kẹt vĩnh viễn; hậu kiểm (REVIEW) thì vẫn cho phép.
  await assertPeriodOpen(tx, v.periodId);
  await updateVoucher(tx, doc, id, { reviewStatus: "RETURNED", reviewedBy: null, reviewedAt: null });
  await addReviewEvent(tx, doc, id, "RETURN", actor.userId, reason);
  await writeAudit(tx, { userId: actor.userId, action: doc === "RECEIPT" ? "receipt.return" : "payment.return", entity: doc === "RECEIPT" ? "Receipt" : "Payment", entityId: id, before: { reviewStatus: v.reviewStatus }, after: { reviewStatus: "RETURNED", reason } });
}

// ── bọc idempotency (D-32: lệnh tạo/duyệt có Idempotency-Key) ────────────────────────────────────────────────────────
type Run<R> = (tx: Tx) => Promise<R>;
const idem = <R,>(prisma: PrismaClient, actor: Actor, scope: string, key: string, run: Run<R>) => withIdempotency(prisma, { userId: actor.userId, scope, key }, run);
export const createReceiptIdempotent = (p: PrismaClient, a: Actor, key: string, i: ReceiptInput) => { assertVoucherPerm(a, "RECEIPT", "create"); return idem(p, a, "receipt.create", key, (tx) => createReceipt(tx, a, i)); };
export const createPaymentIdempotent = (p: PrismaClient, a: Actor, key: string, i: PaymentInput) => { assertVoucherPerm(a, "PAYMENT", "create"); return idem(p, a, "payment.create", key, (tx) => createPayment(tx, a, i)); };
export const reviewVoucherIdempotent = (p: PrismaClient, a: Actor, key: string, doc: VoucherDoc, id: number) => { assertCan(a.perms, "cash.review"); return idem(p, a, `cash.review.${doc}`, key, async (tx) => { await reviewVoucher(tx, a, doc, id); return { id }; }); };
export const returnVoucherIdempotent = (p: PrismaClient, a: Actor, key: string, doc: VoucherDoc, id: number, reason: string) => { assertCan(a.perms, "cash.review"); return idem(p, a, `cash.return.${doc}`, key, async (tx) => { await returnVoucher(tx, a, doc, id, reason); return { id }; }); };
