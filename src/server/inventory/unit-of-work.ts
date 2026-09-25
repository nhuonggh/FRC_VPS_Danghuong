import { assertPeriodOpen, getOpenPeriod } from "@/server/period/guard";
import { lockProducts } from "./lock";
import { DEFAULT_INLINE_LIMIT, type EngineCtx, type Tx } from "./types";

export interface EngineOptions {
  /** Bỏ trống = kỳ đang mở. */
  periodId?: number;
  userId: number;
  /** ĐỦ mọi mã hàng sẽ chạm. Engine khoá theo thứ tự tăng dần. */
  products: number[];
  inlineLimit?: number;
  mode?: "inline" | "worker";
}

/** Mở ngữ cảnh kho trong 1 transaction: kiểm kỳ còn mở → khoá mã hàng (tăng dần). */
export async function beginEngine(tx: Tx, opts: EngineOptions): Promise<EngineCtx> {
  const period = opts.periodId ? await assertPeriodOpen(tx, opts.periodId) : await getOpenPeriod(tx);
  const ctx: EngineCtx = {
    tx, period, userId: opts.userId,
    locked: new Set(), dirty: new Map(), afterCommit: [],
    inlineLimit: opts.inlineLimit ?? DEFAULT_INLINE_LIMIT,
    mode: opts.mode ?? "inline",
  };
  await lockProducts(ctx, opts.products);
  return ctx;
}

/** Ghi nhận mã hàng cần tính lại từ thời điểm `at` (giữ mốc SỚM NHẤT). */
export function markDirty(ctx: Pick<EngineCtx, "dirty">, productId: number, at: Date): void {
  const cur = ctx.dirty.get(productId);
  if (!cur || at < cur) ctx.dirty.set(productId, at);
}

const isDeadlock = (e: unknown): boolean => {
  const x = e as { code?: string; message?: string } | null;
  return x?.code === "P2034" || x?.code === "40P01" || /deadlock detected/i.test(x?.message ?? "");
};

/**
 * Chạy lại cả transaction khi PostgreSQL chọn nó làm nạn nhân deadlock (hiếm: chỉ khi lan truyền giá vốn
 * phải khoá THÊM mã hàng ngoài danh sách khai báo). Lỗi nghiệp vụ không bao giờ được thử lại.
 */
export async function retryOnDeadlock<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isDeadlock(e) || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 60));
    }
  }
}
