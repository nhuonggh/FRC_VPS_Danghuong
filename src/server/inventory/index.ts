/**
 * API CÔNG KHAI của engine kho FIFO — module nghiệp vụ (plan 03+) CHỈ import từ đây (`@/server/inventory`).
 * Tài liệu: docs/engine-fifo.md. Danh sách xuất được ghim bởi tests/inventory/barrel.test.ts — thêm/bớt là quyết định
 * có chủ ý (cập nhật test + tài liệu cùng lúc).
 *
 * CỐ Ý KHÔNG xuất (nội bộ engine): replay (replayProduct, updateLayers), lan truyền / flush / beginEngine / markDirty /
 * retryOnDeadlock / engineTimeouts (mọi thao tác kho đi qua withInventoryTx — transaction, khoá, tính lại, thử lại
 * deadlock, chặn lồng), khoá advisory (lock.ts), lineSnapshot(s), bảng job nội bộ (recompute-jobs.ts), các bước worker
 * cấp thấp (runRecomputePass, resetStuckJobs, sweep…), ReplayTooLargeError, clearCostOwners (chỉ cho test).
 */

// Thời điểm ghi sổ
export { docTimestamp } from "./time";

// Đọc
export { estimateCost, getOnHand } from "./queries";

// Giao dịch kho + cổng ghi
export { withInventoryTx } from "./unit-of-work";
export type { EngineOptions, WithInventoryOptions } from "./unit-of-work";
export { postIssue, postReceipt, productsOfDocument, removeDocument, updateLayerCost } from "./ports";
export type { IssueInput, ReceiptInput } from "./ports";

// Chủ dòng chứng từ (ghi ngược giá vốn vào dòng đơn)
export { registerCostOwner, unitCostOf } from "./owners";
export type { CostOwner, LineCostSnapshot } from "./owners";

// Tính lại chạy nền: khởi động / tắt (instrumentation), công cụ người vận hành
export {
  bootRecomputeWorker, kickRecomputeWorker, recomputeWorkerIdle, retryFailedJob, runRecomputeJobs, stopRecomputeTimers,
} from "./recompute";

// Lỗi
export {
  DependentDocumentsError, DerivedLayerCostError, DerivedLayerDateError, DerivedLayerOrderError, DocDateBeforePeriodError,
  EngineBusyError, EngineInvariantError, InvalidCostError, InvalidCostRefError, InvalidCostRefTypeError, InvalidDocDateError,
  InvalidQuantityError, PeriodClosedError, ProductNotLockedError, ProductRecomputingError,
} from "./errors";

// Kiểu + hằng loại chứng từ
export { IN_DOC_TYPES, OUT_DOC_TYPES } from "./types";
export type { Dec, DecInput, EngineCtx, InDocType, OutDocType, Tx } from "./types";
