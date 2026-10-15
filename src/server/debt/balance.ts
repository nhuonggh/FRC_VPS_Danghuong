import { Prisma, type PrismaClient } from "@prisma/client";
import { getOpenPeriod } from "@/server/period/guard";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface Balance { opening: Prisma.Decimal; debit: Prisma.Decimal; credit: Prisma.Decimal; balance: Prisma.Decimal }

/**
 * Số dư công nợ = đầu kỳ + Σ(debit − credit) — TÍNH KHI ĐỌC, không lưu cột số dư chạy (spec 1.3).
 * Dương = đối tác nợ mình (phải thu), âm = mình nợ đối tác (phải trả). `asOf` (mặc định: hiện tại) lọc theo ngày ghi sổ.
 */
export async function partnerBalance(db: Db, partnerId: number, asOf?: Date): Promise<Balance> {
  const period = await getOpenPeriod(db);
  const [opening, sums] = await Promise.all([
    db.openingDebt.findUnique({ where: { periodId_partnerId: { periodId: period.id, partnerId } }, select: { amount: true } }),
    db.partnerLedger.aggregate({ where: { periodId: period.id, partnerId, ...(asOf ? { at: { lte: asOf } } : {}) }, _sum: { debit: true, credit: true } }),
  ]);
  return toBalance(opening?.amount ?? D(0), sums._sum.debit ?? D(0), sums._sum.credit ?? D(0));
}

export const toBalance = (opening: Prisma.Decimal, debit: Prisma.Decimal, credit: Prisma.Decimal): Balance => ({ opening, debit, credit, balance: opening.plus(debit).minus(credit) });

/** Số dư chiết khấu tích lũy còn lại của đối tác (đầu kỳ + Σ vào − Σ ra). */
export async function discountBalance(db: Db, partnerId: number): Promise<Prisma.Decimal> {
  const period = await getOpenPeriod(db);
  const [opening, sums] = await Promise.all([
    db.openingDiscount.findUnique({ where: { periodId_partnerId: { periodId: period.id, partnerId } }, select: { amount: true } }),
    db.discountLedger.aggregate({ where: { periodId: period.id, partnerId }, _sum: { amountIn: true, amountOut: true } }),
  ]);
  return (opening?.amount ?? D(0)).plus(sums._sum.amountIn ?? 0).minus(sums._sum.amountOut ?? 0);
}
