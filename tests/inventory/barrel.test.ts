import { describe, expect, expectTypeOf, it } from "vitest";
import * as inventory from "@/server/inventory";
import type {
  CostOwner, Dec, DecInput, EngineCtx, EngineOptions, InDocType, IssueInput, LineCostSnapshot, OutDocType, ReceiptInput, Tx,
  WithInventoryOptions,
} from "@/server/inventory";
import { DomainError } from "@/server/http/errors";

/* API công khai của engine: các plan sau CHỈ import từ `@/server/inventory`. Danh sách GHIM — đổi là quyết định có chủ ý. */

const PUBLIC_API = [
  // thời điểm / đọc
  "docTimestamp", "estimateCost", "getOnHand",
  // giao dịch + cổng ghi
  "withInventoryTx", "postIssue", "postReceipt", "postOpeningLots", "productsOfDocument", "removeDocument", "updateLayerCost",
  // chủ dòng
  "registerCostOwner", "unitCostOf",
  // tính lại nền
  "bootRecomputeWorker", "kickRecomputeWorker", "recomputeWorkerIdle", "retryFailedJob", "runRecomputeJobs", "stopRecomputeTimers",
  // lỗi
  "DependentDocumentsError", "DerivedLayerCostError", "DerivedLayerDateError", "DerivedLayerOrderError", "DocDateBeforePeriodError",
  "EngineBusyError", "EngineInvariantError", "InvalidCostError", "InvalidCostRefError", "InvalidCostRefTypeError", "InvalidDocDateError",
  "InvalidQuantityError", "PeriodClosedError", "ProductNotLockedError", "ProductRecomputingError",
  // hằng
  "IN_DOC_TYPES", "OUT_DOC_TYPES",
];

describe("API công khai của engine (các plan sau CHỈ import từ đây)", () => {
  it("xuất ĐÚNG bộ đã cam kết — không thiếu, không thừa", () => {
    expect(Object.keys(inventory).sort()).toEqual([...PUBLIC_API].sort());
  });

  it("KHÔNG lộ phần nội bộ (replay, lan truyền, flush, khoá, bước worker cấp thấp)", () => {
    for (const internal of [
      "replayProduct", "updateLayers", "flush", "beginEngine", "markDirty", "retryOnDeadlock", "engineTimeouts", "lockProducts",
      "lineSnapshot", "lineSnapshots", "clearCostOwners", "getCostOwner", "resolveCostOwner", "registerAllCostOwners", "runRecomputePass", "resetStuckJobs", "resetStaleRunningJobs",
      "sweepRecomputeJobs", "startRecomputeSweep", "isTransientError", "absorbRecomputeJob", "deferRecompute", "mergeRecomputeJob",
      "ReplayTooLargeError", "estimateFromPlainLayers", "plainLayerCosts",
    ]) {
      expect(inventory, internal).not.toHaveProperty(internal);
    }
  });

  it("lỗi nghiệp vụ là DomainError (API trả 4xx có thông điệp); lỗi lập trình thì không (500)", () => {
    for (const E of [
      inventory.PeriodClosedError, inventory.DocDateBeforePeriodError, inventory.InvalidQuantityError, inventory.InvalidCostError,
      inventory.InvalidCostRefError, inventory.InvalidCostRefTypeError, inventory.DerivedLayerCostError, inventory.DerivedLayerDateError,
      inventory.DerivedLayerOrderError, inventory.ProductRecomputingError, inventory.EngineBusyError, inventory.DependentDocumentsError,
    ]) {
      expect(new E(), E.name).toBeInstanceOf(DomainError);
    }
    expect(new inventory.InvalidDocDateError("x")).toBeInstanceOf(DomainError);
    expect(new inventory.EngineInvariantError("x")).not.toBeInstanceOf(DomainError);
    expect(new inventory.ProductNotLockedError(1)).not.toBeInstanceOf(DomainError);
  });

  it("kiểu công khai: cổng nhận/trả `seq` (lưu cùng dòng chứng từ như `at`)", () => {
    expectTypeOf<ReceiptInput["seq"]>().toEqualTypeOf<bigint | undefined>();
    expectTypeOf<IssueInput["seq"]>().toEqualTypeOf<bigint | undefined>();
    expectTypeOf<Awaited<ReturnType<typeof inventory.postReceipt>>>().toEqualTypeOf<{ ledgerId: number; layerId: number; seq: bigint }>();
    expectTypeOf<Awaited<ReturnType<typeof inventory.postIssue>>>().toEqualTypeOf<{ ledgerId: number; seq: bigint }>();
    expectTypeOf<WithInventoryOptions>().toMatchTypeOf<EngineOptions>();
    expectTypeOf<CostOwner>().parameters.toEqualTypeOf<[Tx, LineCostSnapshot]>();
    expectTypeOf<LineCostSnapshot["totalCost"]>().toEqualTypeOf<Dec>();
    expectTypeOf<InDocType>().toEqualTypeOf<(typeof inventory.IN_DOC_TYPES)[number]>();
    expectTypeOf<OutDocType>().toEqualTypeOf<(typeof inventory.OUT_DOC_TYPES)[number]>();
    expectTypeOf<EngineCtx["period"]>().toEqualTypeOf<{ id: number; openedAt: Date }>();
    expectTypeOf<DecInput>().not.toBeNever();
  });
});
