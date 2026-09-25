import { EngineInvariantError, ProductNotLockedError } from "./errors";
import type { EngineCtx } from "./types";

/**
 * Không gian khoá advisory của engine: DẠNG HAI SỐ int4 (LOCK_CLASS_PRODUCT, productId).
 *
 * Postgres tách riêng hai không gian khoá advisory: dạng một bigint `pg_advisory_xact_lock(bigint)`
 * và dạng hai int `pg_advisory_xact_lock(int, int)` KHÔNG BAO GIỜ đụng nhau. Khoá bất biến "còn ≥ 1
 * quản trị viên" ở src/server/users/service.ts dùng dạng bigint đơn (7710001) → tách biệt hẳn với khoá
 * kho ở đây. Mã lớp mới (vd 1002 …) phải khác 1001 và chỉ dùng dạng hai int.
 */
export const LOCK_CLASS_PRODUCT = 1001;

/** Postgres int4 lớn nhất — productId đưa vào `::int` không được vượt. */
const INT4_MAX = 2_147_483_647;

/** Loại trùng và sắp TĂNG DẦN theo số (không theo chuỗi). Không đổi mảng đầu vào. */
export const sortedUniqueIds = (ids: readonly number[]): number[] =>
  [...new Set(ids)].sort((a, b) => a - b);

/**
 * Khoá theo thứ tự product_id TĂNG DẦN (spec 3.0) → mọi giao dịch cùng đi một chiều, không deadlock.
 * Khoá tự nhả khi transaction kết thúc (commit HOẶC rollback — biến thể `xact`).
 * Mã đã khoá trong ctx thì bỏ qua (khoá advisory tái nhập được, nhưng bỏ qua cho nhẹ).
 *
 * Ném EngineInvariantError (lỗi lập trình) nếu có id không phải số nguyên dương int4 — kiểm TOÀN BỘ
 * danh sách trước khi khoá bất cứ mã nào, để không khoá dở dang.
 */
export async function lockProducts(ctx: Pick<EngineCtx, "tx" | "locked">, ids: readonly number[]): Promise<void> {
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 1 || id > INT4_MAX) {
      throw new EngineInvariantError(`Mã hàng không hợp lệ để khoá: ${String(id)} (phải là số nguyên dương ≤ ${INT4_MAX}).`);
    }
  }
  for (const id of sortedUniqueIds(ids)) {
    if (ctx.locked.has(id)) continue;
    await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_CLASS_PRODUCT}::int, ${id}::int)`;
    ctx.locked.add(id);
  }
}

export function assertLocked(ctx: Pick<EngineCtx, "locked">, productId: number): void {
  if (!ctx.locked.has(productId)) throw new ProductNotLockedError(productId);
}
