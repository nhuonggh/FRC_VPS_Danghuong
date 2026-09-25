import { Prisma, type StockDocType } from "@prisma/client";
import type { Dec, Tx } from "./types";

/** Cho chủ dòng: giá đơn vị = tổng / SL, độ chính xác cao, HALF_UP 4 số — cùng hàm engine dùng. */
export { unitCostOf } from "./replay";

/** Giá vốn TỔNG của 1 dòng chứng từ (cộng mọi dòng sổ kho của nó — gồm cả NVL khi bán tôn xốp). */
export interface LineCostSnapshot {
  docType: StockDocType;
  docLineId: number;
  /**
   * Σ qty_out × unit_cost_out (unit_cost_out đã làm tròn 4 số) — tính CHÍNH XÁC bằng numeric của PostgreSQL. Là
   * Prisma.Decimal: phép toán trên nó (div/times…) chỉ giữ 20 chữ số có nghĩa → chủ dòng tính giá đơn vị bằng
   * `unitCostOf(totalCost, qty)` (độ chính xác cao, HALF_UP 4 số), KHÔNG tự `.div()`.
   */
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

export interface LineKey { docType: StockDocType; docLineId: number }

/** lineSnapshot cho NHIỀU dòng trong MỘT câu lệnh (propagate). Trả theo đúng thứ tự `keys`; dòng không có dòng sổ → 0. */
export async function lineSnapshots(tx: Tx, keys: readonly LineKey[]): Promise<LineCostSnapshot[]> {
  if (keys.length === 0) return [];
  const rows = await tx.$queryRaw<{ i: number; total: Prisma.Decimal; prov: Prisma.Decimal }[]>`
    SELECT k.i::int AS i, COALESCE(SUM(s."qtyOut" * s."unitCostOut"), 0) AS total, COALESCE(SUM(s."qtyProvisional"), 0) AS prov
      FROM unnest(${keys.map((k) => k.docType)}::text[], ${keys.map((k) => k.docLineId)}::int[]) WITH ORDINALITY AS k(t, l, i)
      LEFT JOIN stock_ledger s ON s."docType" = k.t::stock_doc_type AND s."docLineId" = k.l AND s."qtyOut" > 0
     GROUP BY k.i`;
  const byIndex = new Map(rows.map((r) => [r.i, r]));
  return keys.map((k, idx) => {
    const r = byIndex.get(idx + 1);
    return { ...k, totalCost: new Prisma.Decimal(r?.total ?? 0), qtyProvisional: new Prisma.Decimal(r?.prov ?? 0) };
  });
}
