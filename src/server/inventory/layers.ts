import { DerivedLayerDateError } from "./errors";
import type { Tx } from "./types";

/** qty_remaining = qty_in − Σ consumption còn lại, cho đúng các lớp chỉ định. */
export async function restoreLayerRemaining(tx: Tx, layerIds: readonly number[]): Promise<void> {
  const ids = [...new Set(layerIds)];
  if (ids.length === 0) return;
  await tx.$executeRaw`
    UPDATE cost_layers cl
       SET "qtyRemaining" = cl."qtyIn" - COALESCE((SELECT SUM(cc.qty) FROM cost_consumptions cc WHERE cc."layerId" = cl.id), 0)
     WHERE cl.id = ANY(${ids}::int[])`;
}

/**
 * Quy tắc THỜI GIAN của lớp phụ thuộc (điều kiện để đồ thị phụ thuộc giá là DAG theo thời gian — xem replay.ts):
 * cùng mã hàng → lớp phải ở SAU HẲN dòng gốc (nếu cùng/lùi thời điểm, dòng gốc có thể ăn chính lớp của nó);
 * khác mã (thành phẩm SX từ NVL) → lớp không được TRƯỚC dòng gốc (cùng thời điểm được).
 */
export function assertDerivedAfterSource(layer: { productId: number; at: Date }, sources: readonly { productId: number; at: Date }[]): void {
  for (const s of sources) {
    const ok = s.productId === layer.productId ? layer.at.getTime() > s.at.getTime() : layer.at.getTime() >= s.at.getTime();
    if (!ok) throw new DerivedLayerDateError();
  }
}
