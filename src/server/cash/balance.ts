import { Prisma, type PrismaClient } from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface CashBalance {
  opening: Prisma.Decimal; in: Prisma.Decimal; out: Prisma.Decimal;
  /** Số dư vận hành = đầu kỳ + Σ(vào − ra), gồm cả phiếu chờ kiểm tra. */
  balance: Prisma.Decimal;
  /** Phần đã kiểm tra (đầu kỳ + phiếu REVIEWED + dòng điều chỉnh đã duyệt). */
  reviewed: Prisma.Decimal;
  /** Phần chờ kiểm tra (PENDING_REVIEW + RETURNED). balance = reviewed + pending. */
  pending: Prisma.Decimal;
}

/** Số dư một quỹ/tài khoản: TÍNH KHI ĐỌC từ sổ (D-31), tách vận hành / đã kiểm tra / chờ kiểm tra (D-33). `asOf` lọc theo ngày ghi sổ. */
export async function cashBalance(db: Db, periodId: number, cashAccountId: number, asOf?: Date): Promise<CashBalance> {
  const [opening, rows] = await Promise.all([
    db.openingCash.findUnique({ where: { periodId_cashAccountId: { periodId, cashAccountId } }, select: { amount: true } }),
    db.$queryRaw<{ tin: Prisma.Decimal; tout: Prisma.Decimal; rin: Prisma.Decimal; rout: Prisma.Decimal }[]>`
      SELECT COALESCE(SUM(cl."amountIn"), 0) AS tin, COALESCE(SUM(cl."amountOut"), 0) AS tout,
        COALESCE(SUM(CASE WHEN cl."docType" = 'CASH_ADJ' OR r."reviewStatus" = 'REVIEWED' OR p."reviewStatus" = 'REVIEWED' THEN cl."amountIn" ELSE 0 END), 0) AS rin,
        COALESCE(SUM(CASE WHEN cl."docType" = 'CASH_ADJ' OR r."reviewStatus" = 'REVIEWED' OR p."reviewStatus" = 'REVIEWED' THEN cl."amountOut" ELSE 0 END), 0) AS rout
      FROM cash_ledger cl
      LEFT JOIN receipts r ON cl."docType" = 'RECEIPT' AND r.id = cl."docId"
      LEFT JOIN payments p ON cl."docType" = 'PAYMENT' AND p.id = cl."docId"
      WHERE cl."periodId" = ${periodId} AND cl."cashAccountId" = ${cashAccountId}
        ${asOf ? Prisma.sql`AND cl."at" <= ${asOf}` : Prisma.empty}`,
  ]);
  const o = opening?.amount ?? D(0); const row = rows[0]!;
  const tin = D(row.tin), tout = D(row.tout);
  const balance = o.plus(tin).minus(tout);
  const reviewed = o.plus(D(row.rin)).minus(D(row.rout));
  return { opening: o, in: tin, out: tout, balance, reviewed, pending: balance.minus(reviewed) };
}
