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

/** Lớp thường của mã trong kỳ, sắp theo thứ tự sự kiện (at, seq) — đầu vào của estimateFromPlainLayers. */
export interface PlainLayerCost { at: Date; unitCost: Dec }

export async function plainLayerCosts(tx: Tx, periodId: number, productId: number): Promise<PlainLayerCost[]> {
  return tx.costLayer.findMany({
    where: { periodId, productId, costRefType: null },
    orderBy: [{ at: "asc" }, { ledger: { seq: "asc" } }],
    select: { at: true, unitCost: true },
  });
}

/**
 * Như estimateCost nhưng trên danh sách đã nạp (replay dùng cho MỌI đơn treo của mã — 1 câu lệnh thay vì 2/đơn):
 * lớp CUỐI có `at ≤ at` → lớp đầu tiên → 0. `layers` phải sắp (at, seq) như plainLayerCosts.
 */
export function estimateFromPlainLayers(layers: readonly PlainLayerCost[], at: Date): Dec {
  const t = at.getTime();
  let lo = 0;
  let hi = layers.length; // tìm vị trí đầu tiên có at > t
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (layers[mid]!.at.getTime() <= t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) return layers[lo - 1]!.unitCost;
  return layers[0]?.unitCost ?? new Prisma.Decimal(0);
}
