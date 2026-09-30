import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Loại chứng từ được phép ghi vào sổ công nợ. Thêm loại mới ⇒ thêm vào đây (một chỗ duy nhất). */
export type LedgerDocType = "DELIVERY" | "RECEIPT" | "RETURN" | "PURCHASE" | "DEBT_ADJ" | "DEBT_TRANSFER" | "PAYMENT" | "CASH_ADJ" | "DISCOUNT_SETTLE" | "TRIP_COLLECT";

/**
 * CỬA DUY NHẤT ghi `partner_ledger` (mọi module gọi qua đây; test kiến trúc cấm `partnerLedger.create/update/delete…`
 * ở nơi khác). Quy ước: số dư = Σ(debit − credit); dương = đối tác nợ mình. Khách nợ thêm / mình trả NCC → `debit`;
 * khách trả/nhận cọc/trả hàng, mua hàng của NCC → `credit`. Số tiền ≤ 0 không ghi dòng nào.
 */
export async function postPartnerLedger(
  tx: Tx,
  e: { periodId: number; partnerId: number; side: "debit" | "credit"; amount: Prisma.Decimal.Value; docType: LedgerDocType; docId: number; at: Date; createdBy: number },
): Promise<void> {
  const amount = D(e.amount);
  if (!amount.gt(0)) return;
  await tx.partnerLedger.create({
    data: { periodId: e.periodId, partnerId: e.partnerId, ...(e.side === "debit" ? { debit: amount } : { credit: amount }), docType: e.docType, docId: e.docId, at: e.at, createdBy: e.createdBy },
  });
}

/** Gỡ mọi dòng sổ công nợ của một chứng từ (hủy/ghi lại chứng từ). */
export async function removePartnerLedger(tx: Tx, docType: LedgerDocType, docId: number): Promise<void> {
  await tx.partnerLedger.deleteMany({ where: { docType, docId } });
}

