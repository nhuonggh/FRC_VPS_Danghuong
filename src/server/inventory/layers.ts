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
 * Lớp phụ thuộc phải đứng SAU mọi dòng sổ của dòng gốc trong THỨ TỰ SỰ KIỆN (at, hạng, id) — xem replay.ts
 * (hạng 0 = lớp thường; hạng 1 = lệnh xuất VÀ lớp phụ thuộc, xếp theo id dòng sổ = thứ tự ghi). Tương đương:
 *  - `at` lớp KHÔNG TRƯỚC `at` dòng gốc (DerivedLayerDateError), và
 *  - dòng sổ của lớp được GHI SAU mọi dòng sổ của dòng gốc: id nhỏ hơn (DerivedLayerOrderError).
 * Áp cho cả cùng mã lẫn khác mã. `ledgerId` bỏ trống khi lớp chưa được ghi (postReceipt — mọi dòng gốc đã có sẵn
 * nên tất nhiên ghi trước).
 */
export function assertDerivedAfterSource(layer: { at: Date; ledgerId?: number }, sources: readonly { at: Date; id?: number }[]): void {
  for (const s of sources) {
    if (layer.at.getTime() < s.at.getTime()) throw new DerivedLayerDateError();
  }
  if (layer.ledgerId === undefined) return;
  for (const s of sources) {
    if (s.id !== undefined && s.id > layer.ledgerId) throw new DerivedLayerOrderError();
  }
}
