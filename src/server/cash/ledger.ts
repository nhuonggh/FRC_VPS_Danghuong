import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Loại chứng từ được phép ghi vào sổ quỹ. `CASH_ADJ` = điều chỉnh phiếu đã kiểm tra (docId = id yêu cầu điều chỉnh). */
export type CashDocType = "RECEIPT" | "PAYMENT" | "CASH_ADJ";

/**
 * CỬA DUY NHẤT ghi `cash_ledger` (D-31; test kiến trúc cấm `cashLedger.create/update/delete…` ở nơi khác).
 * `in` = tiền vào quỹ, `out` = tiền ra. Số dư quỹ = đầu kỳ + Σ(in − out), tính khi đọc. Số tiền ≤ 0 không ghi dòng nào.
 */
export async function postCashLedger(
  tx: Tx,
  e: { periodId: number; cashAccountId: number; side: "in" | "out"; amount: Prisma.Decimal.Value; docType: CashDocType; docId: number; at: Date; createdBy: number },
): Promise<void> {
  const amount = D(e.amount);
  if (!amount.gt(0)) return;
  await tx.cashLedger.create({
    data: { periodId: e.periodId, cashAccountId: e.cashAccountId, ...(e.side === "in" ? { amountIn: amount } : { amountOut: amount }), docType: e.docType, docId: e.docId, at: e.at, createdBy: e.createdBy },
  });
}

/** Gỡ mọi dòng sổ quỹ của một chứng từ (sửa = gỡ rồi ghi lại; hủy phiếu CHƯA kiểm tra). Không dùng cho phiếu đã REVIEWED. */
export async function removeCashLedger(tx: Tx, docType: CashDocType, docId: number): Promise<void> {
  await tx.cashLedger.deleteMany({ where: { docType, docId } });
}
