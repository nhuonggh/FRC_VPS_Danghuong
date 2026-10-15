/**
 * ĐIỂM ĐĂNG KÝ CHỦ DÒNG DUY NHẤT (review I1). Registry trong owners.ts là theo module instance; trước đây chủ dòng chỉ có
 * mặt nếu module nghiệp vụ tình cờ đã được import (tác dụng phụ) → worker nền khởi động từ instrumentation (bundle
 * riêng) hoặc route chưa từng import module bán hàng lẳng lặng bỏ qua chủ dòng và `unit_cost_fifo` / `is_provisional`
 * cũ đi. Giờ:
 *  - `withInventoryTx` (mọi đường vào engine, gồm worker nền `mode: "worker"`) gọi `registerAllCostOwners()` TRƯỚC khi mở
 *    transaction — module này được import TĨNH bởi unit-of-work.ts nên có mặt trong mọi bundle dùng engine;
 *    `bootRecomputeWorker` (instrumentation) cũng gọi khi khởi động;
 *  - lan truyền chạm dòng loại "required" (owners.ts `COST_OWNER_POLICY`) mà chưa có chủ dòng ⇒ EngineInvariantError.
 *
 * ── HAND-OFF PLAN 03+ ────────────────────────────────────────────────────────────────────────────────────────────────
 * Module sở hữu dòng chứng từ xuất có cột giá vốn thêm MỘT dòng vào `COST_OWNER_REGISTRATIONS` bên dưới, vd:
 *
 *   import { saleLineCostOwner } from "@/server/sales/cost-owner";
 *   ...
 *   ["SALE", saleLineCostOwner],
 *
 * Quy tắc: hàm chủ dòng nằm trong file RIÊNG của module (không kéo cả route/handler), chỉ import kiểu + `unitCostOf` từ
 * `@/server/inventory`; KHÔNG gọi `registerCostOwner` rải rác ở nơi khác (test là ngoại lệ). Vòng import
 * (module → barrel → unit-of-work → file này → module) an toàn vì danh sách chỉ được ĐỌC khi hàm dưới đây chạy (lúc gọi
 * engine), không phải lúc nạp module.
 */
import type { StockDocType } from "@prisma/client";
import { saleLineCostOwner } from "@/server/sales/cost-owner";
import { getCostOwner, registerCostOwner, type CostOwner } from "./owners";

/** Danh sách đăng ký trung tâm. */
const COST_OWNER_REGISTRATIONS = (): readonly (readonly [StockDocType, CostOwner])[] => [
  ["SALE", saleLineCostOwner], // plan 04 — dòng đơn bán (sale_order_lines.unitCostFifo / isProvisional)
];

let registered = false;

/** Idempotent (1 lần / module instance). Test xoá registry bằng clearCostOwners — không đăng ký lại sau đó. */
export function registerAllCostOwners(): void {
  if (registered) return;
  registered = true;
  // Không ghi đè chủ dòng đã có (test tiêm chủ dòng riêng/rỗng trước khi engine chạy lần đầu)
  for (const [docType, owner] of COST_OWNER_REGISTRATIONS()) if (!getCostOwner(docType)) registerCostOwner(docType, owner);
}
