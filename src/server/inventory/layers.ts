import { DerivedLayerDateError, DerivedLayerOrderError } from "./errors";
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
 * Lớp phụ thuộc phải đứng SAU mọi dòng sổ của dòng gốc trong THỨ TỰ SỰ KIỆN (at, hạng, seq) — xem replay.ts
 * (hạng 0 = lớp thường; hạng 1 = lệnh xuất VÀ lớp phụ thuộc, xếp theo `seq` = thứ tự ghi ổn định). Tương đương:
 *  - `at` lớp KHÔNG TRƯỚC `at` dòng gốc (DerivedLayerDateError), và
 *  - `seq` dòng sổ của lớp LỚN HƠN seq mọi dòng sổ của dòng gốc (DerivedLayerOrderError).
 * Áp cho cả cùng mã lẫn khác mã. `seq` của lớp bỏ trống khi chỉ kiểm `at` (postReceipt kiểm seq riêng).
 */
export function assertDerivedAfterSource(layer: { at: Date; seq?: bigint }, sources: readonly { at: Date; seq?: bigint }[]): void {
  for (const s of sources) {
    if (layer.at.getTime() < s.at.getTime()) throw new DerivedLayerDateError();
  }
  if (layer.seq === undefined) return;
  for (const s of sources) {
    if (s.seq !== undefined && s.seq > layer.seq) throw new DerivedLayerOrderError();
  }
}
