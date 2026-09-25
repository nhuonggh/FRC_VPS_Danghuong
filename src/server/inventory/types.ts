import type { Prisma, StockDocType } from "@prisma/client";

export type Tx = Prisma.TransactionClient;
export type Dec = Prisma.Decimal;
export type DecInput = Prisma.Decimal.Value;

/** Ngữ cảnh của MỘT transaction kho. Tạo bằng beginEngine / withInventoryTx — không tự dựng. */
export interface EngineCtx {
  tx: Tx;
  period: { id: number; openedAt: Date };
  userId: number;
  /** Mã hàng đã giữ advisory lock trong transaction này. */
  locked: Set<number>;
  /** product → thời điểm SỚM NHẤT cần tính lại. */
  dirty: Map<number, Date>;
  /** Chạy SAU khi commit (vd đánh thức worker nền). */
  afterCommit: (() => void)[];
  /** Ngưỡng số sự kiện cho tính lại đồng bộ (spec 3.5: ~2.000). */
  inlineLimit: number;
  /** worker = đang chạy nền: không giới hạn ngưỡng, không bị chặn bởi cờ recomputing. */
  mode: "inline" | "worker";
}

export const IN_DOC_TYPES = [
  "OPENING",
  "PURCHASE",
  "ADJ_IN",
  "RETURN_IN",
  "PRODUCTION_OUT",
  "STOCKTAKE_IN",
] as const satisfies readonly StockDocType[];

export const OUT_DOC_TYPES = [
  "SALE",
  "ADJ_LOSS",
  "WRITE_OFF",
  "RETURN_SUPPLIER",
  "PRODUCTION_USE",
  "PROCESSING_USE",
  "STOCKTAKE_OUT",
] as const satisfies readonly StockDocType[];

export type InDocType = (typeof IN_DOC_TYPES)[number];
export type OutDocType = (typeof OUT_DOC_TYPES)[number];

export const DEFAULT_INLINE_LIMIT = 2000;
