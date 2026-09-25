import { Prisma, type PrismaClient } from "@prisma/client";
import type { Dec, Tx } from "./types";

/** Tồn = Σ qty_remaining − Σ qty_provisional (tính khi đọc — spec 1.3). Âm khi đang bán âm kho. */
export async function getOnHand(db: Tx | PrismaClient, periodId: number, productId: number): Promise<Dec> {
  const rows = await db.$queryRaw<{ on_hand: Prisma.Decimal }[]>`
    SELECT COALESCE((SELECT SUM("qtyRemaining") FROM cost_layers WHERE "periodId" = ${periodId} AND "productId" = ${productId}), 0)
         - COALESCE((SELECT SUM("qtyProvisional") FROM stock_ledger WHERE "periodId" = ${periodId} AND "productId" = ${productId}), 0) AS on_hand`;
  return new Prisma.Decimal(rows[0]!.on_hand);
}

/**
 * Giá vốn tạm cho phần xuất chưa có lớp: giá lớp THƯỜNG gần nhất tại thời điểm xuất → lớp thường đầu tiên → 0.
 * "Gần nhất"/"đầu tiên" theo THỨ TỰ SỰ KIỆN (at, seq dòng sổ) — KHÔNG theo id lớp: sửa/khôi phục phiếu nhập cấp id
 * lớp mới nhưng giữ `at` + `seq`, nên giá tạm không đổi theo lịch sử sửa. Lớp thường cùng `at` luôn đứng trước lệnh
 * xuất (hạng 0) nên điều kiện `at ≤ at xuất` khớp đúng thứ tự sự kiện.
 */
export async function estimateCost(tx: Tx, periodId: number, productId: number, at: Date): Promise<Dec> {
  const before = await tx.costLayer.findFirst({
    where: { periodId, productId, costRefType: null, at: { lte: at } },
    orderBy: [{ at: "desc" }, { ledger: { seq: "desc" } }],
    select: { unitCost: true },
  });
  if (before) return before.unitCost;
  const first = await tx.costLayer.findFirst({
    where: { periodId, productId, costRefType: null },
    orderBy: [{ at: "asc" }, { ledger: { seq: "asc" } }],
    select: { unitCost: true },
  });
  return first?.unitCost ?? new Prisma.Decimal(0);
}
