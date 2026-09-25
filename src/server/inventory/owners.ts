import { Prisma, type StockDocType } from "@prisma/client";
import { EngineInvariantError } from "./errors";
import { OUT_DOC_TYPES, type Dec, type OutDocType, type Tx } from "./types";

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

/**
 * Chính sách chủ dòng cho TỪNG loại chứng từ xuất (FAIL CLOSED — review I1):
 *  - "required": dòng loại này có cột giá vốn của riêng nó (vd `sale_order_lines.unit_cost_fifo` / `is_provisional`)
 *    → lan truyền chạm dòng mà CHƯA đăng ký chủ dòng ⇒ EngineInvariantError (không lẳng lặng bỏ qua để cột giá vốn cũ).
 *  - "optional": không có cột giá vốn cần ghi ngược (giá vốn chỉ nằm ở sổ kho / lớp phụ thuộc do engine quản); được
 *    đăng ký nếu module muốn nghe, không đăng ký cũng không sao.
 * `Record<OutDocType, …>` bắt buộc liệt kê ĐỦ loại xuất: thêm loại vào OUT_DOC_TYPES mà quên quyết định ở đây ⇒ lỗi
 * biên dịch. Module plan 03+ thêm cột giá vốn cho loại khác (vd PROCESSING_USE) ⇒ đổi sang "required" + đăng ký chủ
 * dòng trong `owners-register.ts`.
 */
export const COST_OWNER_POLICY = {
  SALE: "required",
  ADJ_LOSS: "optional",
  WRITE_OFF: "optional",
  RETURN_SUPPLIER: "optional",
  PRODUCTION_USE: "optional", // giá thành phẩm = lớp phụ thuộc PRODUCTION_OUT, engine tự tính
  PROCESSING_USE: "optional",
  STOCKTAKE_OUT: "optional",
} as const satisfies Record<OutDocType, "required" | "optional">;

/** Loại xuất BẮT BUỘC có chủ dòng (suy ra từ COST_OWNER_POLICY — không liệt kê tay lần hai). */
export const OWNER_REQUIRED_DOC_TYPES: readonly OutDocType[] = OUT_DOC_TYPES.filter((t) => COST_OWNER_POLICY[t] === "required");

const owners = new Map<StockDocType, CostOwner>();

export function registerCostOwner(docType: StockDocType, owner: CostOwner): void {
  owners.set(docType, owner);
}
export function getCostOwner(docType: StockDocType): CostOwner | undefined {
  return owners.get(docType);
}

/**
 * Chủ dòng cho dòng `docType` mà lan truyền vừa chạm. Loại "required" chưa đăng ký ⇒ EngineInvariantError (lỗi lập
 * trình: quên đăng ký trong `owners-register.ts`); loại không phải chứng từ xuất ⇒ EngineInvariantError.
 */
export function resolveCostOwner(docType: StockDocType): CostOwner | undefined {
  const policy = (COST_OWNER_POLICY as Partial<Record<StockDocType, "required" | "optional">>)[docType];
  if (!policy) throw new EngineInvariantError(`Lan truyền giá vốn chạm dòng loại ${docType} — không phải chứng từ xuất.`);
  const owner = owners.get(docType);
  if (!owner && policy === "required") {
    throw new EngineInvariantError(
      `Chưa đăng ký chủ dòng (registerCostOwner) cho loại chứng từ ${docType}: giá vốn dòng (unit_cost_fifo / is_provisional) sẽ không được cập nhật. Đăng ký trong src/server/inventory/owners-register.ts.`,
    );
  }
  return owner;
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
