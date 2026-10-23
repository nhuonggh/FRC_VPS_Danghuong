import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;
export interface LaneKey { productId: number; processingTypeId?: number | null }

/**
 * Kho con theo kiểu gia công (vd bình khí: Mua vỏ / Đổi khí). Người dùng chỉ thấy MỘT sản phẩm + kiểu; tồn kho và FIFO
 * chạy trên mã kho thực sự. Không có dòng cấu hình (hoặc không chọn kiểu) ⇒ kho là chính sản phẩm — hàng cũ không đổi.
 * Engine FIFO không biết khái niệm này: mọi chỗ gọi engine đổi productId bằng hàm ở đây trước.
 */
export async function stockProductId(db: Db, productId: number, processingTypeId: number | null | undefined): Promise<number> {
  if (!processingTypeId) return productId;
  const lane = await db.productStockLane.findUnique({ where: { productId_processingTypeId: { productId, processingTypeId } }, select: { stockProductId: true } });
  return lane?.stockProductId ?? productId;
}

/** Mã kho cho nhiều dòng (giữ thứ tự, có thể trùng) — dùng khi dựng danh sách mã cần khoá trước giao dịch kho. */
export async function stockProductIdsOf(db: Db, keys: readonly LaneKey[]): Promise<number[]> {
  const typed = keys.filter((k) => k.processingTypeId);
  const lanes = typed.length === 0 ? [] : await db.productStockLane.findMany({
    where: { OR: typed.map((k) => ({ productId: k.productId, processingTypeId: k.processingTypeId! })) },
    select: { productId: true, processingTypeId: true, stockProductId: true },
  });
  const map = new Map(lanes.map((l) => [`${l.productId}:${l.processingTypeId}`, l.stockProductId]));
  return keys.map((k) => (k.processingTypeId ? map.get(`${k.productId}:${k.processingTypeId}`) : undefined) ?? k.productId);
}

/** Tập mã kho đã sắp xếp, không trùng (đúng dạng `products` của withInventoryTx). */
export async function lockIdsOf(db: Db, keys: readonly LaneKey[]): Promise<number[]> {
  return [...new Set(await stockProductIdsOf(db, keys))].sort((a, b) => a - b);
}

/** Mọi mã kho của một sản phẩm (chính nó + các kho con) — để cộng tồn / xem giá nhập theo sản phẩm. */
export async function laneStockIds(db: Db, productId: number): Promise<number[]> {
  const lanes = await db.productStockLane.findMany({ where: { productId }, select: { stockProductId: true } });
  return [...new Set([productId, ...lanes.map((l) => l.stockProductId)])];
}
