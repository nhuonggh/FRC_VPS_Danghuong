import { Prisma, type PrismaClient } from "@prisma/client";

/** Bảng chứng từ có `periodId` được phép hỏi (danh sách trắng — tên bảng đi vào SQL thô). */
const TABLES = {
  saleOrder: "sale_orders", purchase: "purchases", receipt: "receipts", payment: "payments", goodsReturn: "goods_returns", trip: "trips",
} as const;
export type PeriodedDoc = keyof typeof TABLES;

export interface ClosedPeriodInfo { id: number; name: string; closedAt: Date | null }

/**
 * Kỳ ĐÃ KẾT SỔ của một chứng từ, hoặc null nếu chứng từ thuộc kỳ đang mở / không tồn tại. Màn chi tiết dùng để hiện banner
 * "chỉ đọc" và ẩn nút sửa/hủy (server vẫn chặn thật — xem tests/period/cross-period-matrix.test.ts).
 */
export async function closedPeriodOf(db: PrismaClient, doc: PeriodedDoc, id: number): Promise<ClosedPeriodInfo | null> {
  const rows = await db.$queryRaw<ClosedPeriodInfo[]>(Prisma.sql`
    SELECT p.id, p.name, p."closedAt" FROM periods p JOIN ${Prisma.raw(`"${TABLES[doc]}"`)} t ON t."periodId" = p.id
     WHERE t.id = ${id} AND p.status = 'CLOSED'`);
  return rows[0] ?? null;
}
