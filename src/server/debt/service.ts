import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { docTimestamp } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import { discountBalance, partnerBalance } from "./balance";
import { postPartnerLedger, removePartnerLedger } from "./ledger";
import type { DebtAdjustmentInput, DebtTransferInput } from "./schemas";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Khoá các đối tác theo id tăng dần (tránh deadlock) để tuần tự hoá điều chỉnh/gộp cùng đối tác. */
async function lockPartners(tx: Tx, ids: number[]) {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) await tx.$queryRaw`SELECT id FROM partners WHERE id = ${id} FOR UPDATE`;
}

async function loadPartner(tx: Tx, actor: Actor, id: number, what = "đối tác") {
  const p = await tx.partner.findFirst({ where: { id, ...partnerScopeWhere(actor) }, select: { id: true, code: true, name: true, isCustomer: true, isSupplier: true, isActive: true, mergedIntoId: true } });
  if (!p) throw new DomainError(`Không tìm thấy ${what}.`, 404);
  if (p.mergedIntoId !== null) throw new DomainError(`${p.code} đã được gộp vào mã khác, không thao tác được.`, 409);
  return p;
}

// ───────────────────────────── ĐIỀU CHỈNH (64) ─────────────────────────────
/**
 * Điều chỉnh công nợ: `amount` lưu CÓ DẤU theo số dư (giảm = âm ⇒ credit; tăng = dương ⇒ debit). Lý do CHIET_KHAU trừ
 * nợ bằng sổ chiết khấu tích lũy: tiêu hao số dư chiết khấu (`amountOut`, bù trừ công nợ), không vượt số dư còn.
 */
export async function createDebtAdjustment(tx: Tx, actor: Actor, input: DebtAdjustmentInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertCan(actor.perms, "debt.adjust");
  await lockPartners(tx, [input.partnerId]);
  const partner = await loadPartner(tx, actor, input.partnerId);
  const period = await getOpenPeriod(tx);
  const at = docTimestamp(input.date, now);
  const amount = D(input.amount);
  const signed = input.direction === "DECREASE" ? amount.negated() : amount;

  if (input.reason === "CHIET_KHAU") {
    const left = await discountBalance(tx, partner.id);
    if (amount.gt(left)) throw new DomainError(`Số dư chiết khấu tích lũy của ${partner.code} chỉ còn ${left.toString()}, không đủ để trừ ${amount.toString()}.`, 400);
  }
  const id = await nextDocId(tx, "debt_adjustments");
  const code = formatDocCode("DC", id);
  await tx.debtAdjustment.create({ data: { id, code, periodId: period.id, partnerId: partner.id, reason: input.reason, amount: signed, at, note: input.note, createdBy: actor.userId } });
  await postPartnerLedger(tx, { periodId: period.id, partnerId: partner.id, side: signed.gt(0) ? "debit" : "credit", amount: amount, docType: "DEBT_ADJ", docId: id, at, createdBy: actor.userId });
  if (input.reason === "CHIET_KHAU") {
    await tx.discountLedger.create({ data: { periodId: period.id, partnerId: partner.id, amountOut: amount, settleMethod: "OFFSET", docType: "DEBT_ADJ", docId: id, at, createdBy: actor.userId } });
  }
  await writeAudit(tx, { userId: actor.userId, action: "debt.adjust", entity: "DebtAdjustment", entityId: id, after: { code, partnerCode: partner.code, reason: input.reason, amount: signed.toString() } });
  return { id, code };
}

export async function createDebtAdjustmentIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: DebtAdjustmentInput, now: Date = new Date()) {
  assertCan(actor.perms, "debt.adjust");
  return withIdempotency(prisma, { userId: actor.userId, scope: "debt.adjust", key }, (tx) => createDebtAdjustment(tx, actor, input, now));
}

export async function cancelDebtAdjustment(tx: Tx, actor: Actor, id: number, reason: string, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "debt.adjust");
  const head = await tx.debtAdjustment.findUnique({ where: { id }, select: { partnerId: true } });
  if (!head) throw new DomainError("Không tìm thấy phiếu điều chỉnh.", 404);
  await lockPartners(tx, [head.partnerId]);
  const adj = await tx.debtAdjustment.findUniqueOrThrow({ where: { id } });
  if (adj.isCancelled) throw new DomainError("Phiếu điều chỉnh đã hủy trước đó.", 409);
  const period = await getOpenPeriod(tx);
  if (adj.periodId !== period.id) throw new DomainError("Phiếu thuộc kỳ đã kết sổ, không hủy được.", 409);
  const partner = await tx.partner.findFirst({ where: { id: adj.partnerId, ...partnerScopeWhere(actor) }, select: { id: true } });
  if (!partner) throw new DomainError("Không tìm thấy phiếu điều chỉnh.", 404);
  await removePartnerLedger(tx, "DEBT_ADJ", id);
  if (adj.reason === "CHIET_KHAU") {
    await tx.discountLedger.create({ data: { periodId: period.id, partnerId: adj.partnerId, amountIn: adj.amount.abs(), docType: "DEBT_ADJ_CANCEL", docId: id, at: now, createdBy: actor.userId } });
  }
  await tx.debtAdjustment.update({ where: { id }, data: { isCancelled: true, cancelledAt: now, cancelledBy: actor.userId, cancelReason: reason } });
  await writeAudit(tx, { userId: actor.userId, action: "debt.adjust_cancel", entity: "DebtAdjustment", entityId: id, before: { code: adj.code }, after: { isCancelled: true, reason } });
}

// ───────────────────────────── GỘP / CHUYỂN (65) ─────────────────────────────
/**
 * Chuyển số dư giữa hai đối tác: bên chuyển giảm, bên nhận tăng CÙNG số tiền (Σ hai vế cân). MERGE: chuyển toàn bộ số
 * dư (kể cả đầu kỳ) và số dư chiết khấu, rồi đánh dấu bên chuyển đã gộp (`mergedIntoId`) và ngừng hoạt động — lịch sử
 * chứng từ giữ nguyên tại mã cũ. Không thao tác với đối tác đã gộp; bên nhận phải bao được vai trò của bên chuyển.
 */
export async function createDebtTransfer(tx: Tx, actor: Actor, input: DebtTransferInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertCan(actor.perms, "debt.adjust");
  await lockPartners(tx, [input.fromPartnerId, input.toPartnerId]);
  const from = await loadPartner(tx, actor, input.fromPartnerId, "đối tác chuyển");
  const to = await loadPartner(tx, actor, input.toPartnerId, "đối tác nhận");
  if (!to.isActive) throw new DomainError(`${to.code} đã ngừng hoạt động, không nhận nợ được.`, 400);
  const period = await getOpenPeriod(tx);
  const at = docTimestamp(input.date, now);

  let amount: Prisma.Decimal;
  let discountMoved = D(0);
  if (input.kind === "MERGE") {
    if ((from.isCustomer && !to.isCustomer) || (from.isSupplier && !to.isSupplier)) throw new DomainError("Mã giữ lại phải có đủ vai trò (khách/NCC) của mã cần gộp.", 400);
    amount = (await partnerBalance(tx, from.id)).balance;
    discountMoved = await discountBalance(tx, from.id);
    if (discountMoved.lt(0)) discountMoved = D(0);
  } else {
    amount = D(input.amount);
  }

  const id = await nextDocId(tx, "debt_transfers");
  const code = formatDocCode("CN", id);
  await tx.debtTransfer.create({
    data: { id, code, periodId: period.id, kind: input.kind, fromPartnerId: from.id, toPartnerId: to.id, amount, discountMoved, at, note: input.note || null, createdBy: actor.userId },
  });
  const abs = amount.abs();
  // amount > 0: bên chuyển giảm số dư (credit), bên nhận tăng (debit); amount < 0 (gộp mã đang âm) thì ngược lại
  const fromSide = amount.gt(0) ? "credit" : "debit";
  await postPartnerLedger(tx, { periodId: period.id, partnerId: from.id, side: fromSide, amount: abs, docType: "DEBT_TRANSFER", docId: id, at, createdBy: actor.userId });
  await postPartnerLedger(tx, { periodId: period.id, partnerId: to.id, side: fromSide === "credit" ? "debit" : "credit", amount: abs, docType: "DEBT_TRANSFER", docId: id, at, createdBy: actor.userId });
  if (discountMoved.gt(0)) {
    await tx.discountLedger.create({ data: { periodId: period.id, partnerId: from.id, amountOut: discountMoved, docType: "DEBT_TRANSFER", docId: id, at, createdBy: actor.userId } });
    await tx.discountLedger.create({ data: { periodId: period.id, partnerId: to.id, amountIn: discountMoved, docType: "DEBT_TRANSFER", docId: id, at, createdBy: actor.userId } });
  }
  if (input.kind === "MERGE") await tx.partner.update({ where: { id: from.id }, data: { mergedIntoId: to.id, isActive: false } });
  await writeAudit(tx, { userId: actor.userId, action: "debt.transfer", entity: "DebtTransfer", entityId: id, after: { code, kind: input.kind, from: from.code, to: to.code, amount: amount.toString() } });
  return { id, code };
}

export async function createDebtTransferIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: DebtTransferInput, now: Date = new Date()) {
  assertCan(actor.perms, "debt.adjust");
  return withIdempotency(prisma, { userId: actor.userId, scope: "debt.transfer", key }, (tx) => createDebtTransfer(tx, actor, input, now));
}

export async function cancelDebtTransfer(tx: Tx, actor: Actor, id: number, reason: string, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "debt.adjust");
  const head = await tx.debtTransfer.findUnique({ where: { id }, select: { fromPartnerId: true, toPartnerId: true } });
  if (!head) throw new DomainError("Không tìm thấy phiếu chuyển.", 404);
  await lockPartners(tx, [head.fromPartnerId, head.toPartnerId]);
  const t = await tx.debtTransfer.findUniqueOrThrow({ where: { id }, include: { from: true, to: true } });
  if (t.isCancelled) throw new DomainError("Phiếu chuyển đã hủy trước đó.", 409);
  const period = await getOpenPeriod(tx);
  if (t.periodId !== period.id) throw new DomainError("Phiếu thuộc kỳ đã kết sổ, không hủy được.", 409);
  const visible = await tx.partner.count({ where: { id: { in: [t.fromPartnerId, t.toPartnerId] }, ...partnerScopeWhere(actor) } });
  if (visible < 2) throw new DomainError("Không tìm thấy phiếu chuyển.", 404);
  if (t.kind === "MERGE") {
    if (t.to.mergedIntoId !== null) throw new DomainError(`${t.to.code} đã được gộp tiếp vào mã khác. Hủy phiếu gộp đó trước.`, 409);
    if (t.from.mergedIntoId !== t.toPartnerId) throw new DomainError("Trạng thái gộp đã thay đổi, không hủy được.", 409);
  }
  await removePartnerLedger(tx, "DEBT_TRANSFER", id);
  if (t.discountMoved.gt(0)) {
    await tx.discountLedger.create({ data: { periodId: period.id, partnerId: t.fromPartnerId, amountIn: t.discountMoved, docType: "DEBT_TRANSFER_CANCEL", docId: id, at: now, createdBy: actor.userId } });
    await tx.discountLedger.create({ data: { periodId: period.id, partnerId: t.toPartnerId, amountOut: t.discountMoved, docType: "DEBT_TRANSFER_CANCEL", docId: id, at: now, createdBy: actor.userId } });
  }
  if (t.kind === "MERGE") await tx.partner.update({ where: { id: t.fromPartnerId }, data: { mergedIntoId: null, isActive: true } });
  await tx.debtTransfer.update({ where: { id }, data: { isCancelled: true, cancelledAt: now, cancelledBy: actor.userId, cancelReason: reason } });
  await writeAudit(tx, { userId: actor.userId, action: "debt.transfer_cancel", entity: "DebtTransfer", entityId: id, before: { code: t.code }, after: { isCancelled: true, reason } });
}
