import { Prisma } from "@prisma/client";
import { assertDocDateInPeriod } from "@/server/period/guard";
import { EngineInvariantError, InvalidCostError, InvalidQuantityError, PeriodClosedError } from "./errors";
import type { DecInput, Tx } from "./types";

export interface OpeningLot {
  productId: number;
  qty: DecInput;
  unitCost: DecInput;
  /** Id dòng `opening_stock` tương ứng — dùng làm `docId` = `docLineId` (mỗi lô một dòng, như nhập tay ở màn Tồn đầu kỳ). */
  openingId: number;
}

const CHUNK = 2000;

/**
 * Ghi HÀNG LOẠT lô OPENING vào kỳ mới khi KẾT SỔ (Plan 07 F1b): mỗi lô = 1 dòng `stock_ledger` (qtyIn) + 1 lớp
 * `cost_layers` giữ nguyên `qty` và `unitCost` của lô cũ. Khác `postReceipt` chỗ không tính lại chuỗi: kỳ mới còn trống
 * (chưa có dòng xuất) nên mỗi lớp mới đã đúng (`qtyRemaining = qtyIn`), và gọi từng lô qua `postReceipt` mất hàng chục
 * giây với hàng chục nghìn lô (spec: kết sổ tính bằng câu lệnh tập hợp, không lặp từng dòng trong Node).
 *
 * Điều kiện (người gọi — `closeOpenPeriod` — đảm bảo): đang giữ `FOR UPDATE` dòng kỳ cũ VÀ kỳ mới vừa tạo trong cùng
 * transaction, nên không giao dịch kho nào khác chạm được cả hai kỳ. Hàm tự kiểm: kỳ đích đang mở; kỳ đích CHƯA có dòng
 * sổ kho nào; mọi qty > 0, unitCost ≥ 0; `at` không trước ngày mở kỳ.
 * THỨ TỰ MẢNG `lots` = thứ tự FIFO: lô đứng trước nhận `seq` nhỏ hơn (cùng `at`) nên được xuất trước.
 * Trả số lô đã ghi.
 */
export async function postOpeningLots(tx: Tx, input: { period: { id: number; openedAt: Date }; userId: number; at: Date; lots: OpeningLot[] }): Promise<number> {
  const { period, userId, at, lots } = input;
  const open = await tx.period.findFirst({ where: { id: period.id, isOpen: true }, select: { id: true } });
  if (!open) throw new PeriodClosedError();
  assertDocDateInPeriod(period, at);
  if (await tx.stockLedger.count({ where: { periodId: period.id } })) {
    throw new EngineInvariantError("Kỳ đích đã có dòng sổ kho — chỉ ghi lô đầu kỳ hàng loạt vào kỳ còn trống.");
  }
  const prepared = lots.map((l) => {
    const qty = new Prisma.Decimal(l.qty), unitCost = new Prisma.Decimal(l.unitCost).toDecimalPlaces(4);
    if (!qty.gt(0)) throw new InvalidQuantityError();
    if (unitCost.lt(0)) throw new InvalidCostError();
    return { ...l, qty, unitCost };
  });
  for (let i = 0; i < prepared.length; i += CHUNK) {
    const part = prepared.slice(i, i + CHUNK);
    // createManyAndReturn giữ thứ tự VALUES → `seq` (DEFAULT nextval) tăng theo đúng thứ tự `lots`
    const ledgers = await tx.stockLedger.createManyAndReturn({
      data: part.map((l) => ({ periodId: period.id, productId: l.productId, docType: "OPENING" as const, docId: l.openingId, docLineId: l.openingId, qtyIn: l.qty, qtyOut: 0, unitCostOut: 0, qtyProvisional: 0, at, createdBy: userId })),
      select: { id: true, docLineId: true },
    });
    const ledgerOf = new Map(ledgers.map((r) => [r.docLineId, r.id]));
    await tx.costLayer.createMany({
      data: part.map((l) => ({
        periodId: period.id, productId: l.productId, sourceDocType: "OPENING" as const, sourceDocId: l.openingId, sourceLineId: l.openingId,
        ledgerId: ledgerOf.get(l.openingId)!, qtyIn: l.qty, qtyRemaining: l.qty, unitCost: l.unitCost, at,
      })),
    });
  }
  return prepared.length;
}
