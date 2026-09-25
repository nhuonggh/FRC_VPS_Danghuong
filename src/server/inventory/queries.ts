import { Prisma, type PrismaClient } from "@prisma/client";
import type { Dec, Tx } from "./types";

/** Tồn = Σ qty_remaining − Σ qty_provisional (tính khi đọc — spec 1.3). Âm khi đang bán âm kho. */
export async function getOnHand(db: Tx | PrismaClient, periodId: number, productId: number): Promise<Dec> {
  const rows = await db.$queryRaw<{ on_hand: Prisma.Decimal }[]>`
    SELECT COALESCE((SELECT SUM("qtyRemaining") FROM cost_layers WHERE "periodId" = ${periodId} AND "productId" = ${productId}), 0)
         - COALESCE((SELECT SUM("qtyProvisional") FROM stock_ledger WHERE "periodId" = ${periodId} AND "productId" = ${productId}), 0) AS on_hand`;
  return new Prisma.Decimal(rows[0]!.on_hand);
}

/** Giá vốn tạm cho phần xuất chưa có lớp: giá nhập gần nhất tại thời điểm xuất → lớp đầu tiên → 0. */
export async function estimateCost(tx: Tx, periodId: number, productId: number, at: Date): Promise<Dec> {
  const before = await tx.costLayer.findFirst({
    where: { periodId, productId, costRefType: null, at: { lte: at } },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { unitCost: true },
  });
  if (before) return before.unitCost;
  const first = await tx.costLayer.findFirst({
    where: { periodId, productId, costRefType: null },
    orderBy: [{ at: "asc" }, { id: "asc" }],
    select: { unitCost: true },
  });
  return first?.unitCost ?? new Prisma.Decimal(0);
}
