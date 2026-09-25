import { Prisma, type StockDocType } from "@prisma/client";
import type { Dec, Tx } from "./types";

/** Giá vốn TỔNG của 1 dòng chứng từ (cộng mọi dòng sổ kho của nó — gồm cả NVL khi bán tôn xốp). */
export interface LineCostSnapshot {
  docType: StockDocType;
  docLineId: number;
  /** Σ qty_out × unit_cost_out (unit_cost_out đã làm tròn 4 số) — tính bằng numeric của PostgreSQL, không dùng float. */
  totalCost: Dec;
  /** > 0 ⇔ dòng đang "đơn treo" (chưa đủ tồn). */
  qtyProvisional: Dec;
}

/**
 * Chủ sở hữu dòng chứng từ (vd dòng đơn bán) đăng ký hàm ghi ngược `unit_cost_fifo` / `is_provisional`
 * vào bảng của nó. Engine gọi (trong cùng transaction) cho MỌI dòng xuất mà lần tính lại chạm tới.
 */
export type CostOwner = (tx: Tx, snap: LineCostSnapshot) => Promise<void>;

const owners = new Map<StockDocType, CostOwner>();

export function registerCostOwner(docType: StockDocType, owner: CostOwner): void {
  owners.set(docType, owner);
}
export function getCostOwner(docType: StockDocType): CostOwner | undefined {
  return owners.get(docType);
}
/** Chỉ dùng trong test. */
export function clearCostOwners(): void {
  owners.clear();
}

export async function lineSnapshot(tx: Tx, docType: StockDocType, docLineId: number): Promise<LineCostSnapshot> {
  const rows = await tx.$queryRaw<{ total: Prisma.Decimal; prov: Prisma.Decimal }[]>`
    SELECT COALESCE(SUM("qtyOut" * "unitCostOut"), 0) AS total, COALESCE(SUM("qtyProvisional"), 0) AS prov
      FROM stock_ledger
     WHERE "docType"::text = ${docType} AND "docLineId" = ${docLineId} AND "qtyOut" > 0`;
  return { docType, docLineId, totalCost: new Prisma.Decimal(rows[0]!.total), qtyProvisional: new Prisma.Decimal(rows[0]!.prov) };
}
