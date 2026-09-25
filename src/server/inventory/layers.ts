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
 * VỊ TRÍ SỰ KIỆN của lớp phải SAU dòng gốc. Dòng gốc là lệnh xuất (lớp sự kiện 1), lớp phụ thuộc là lớp sự kiện 2 →
 * tương đương `at` lớp KHÔNG TRƯỚC `at` dòng gốc (cùng `at` hợp lệ: bán + trả lùi ngày cùng ngày, gia công lại),
 * cho cả cùng mã lẫn khác mã.
 */
export function assertDerivedAfterSource(layer: { at: Date }, sources: readonly { at: Date }[]): void {
  for (const s of sources) {
    if (layer.at.getTime() < s.at.getTime()) throw new DerivedLayerDateError();
  }
}
