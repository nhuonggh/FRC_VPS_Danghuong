import type { Prisma, PrismaClient } from "@prisma/client";

export interface IdempotencyOptions {
  userId: number;
  scope: string; // vd "order.create"
  key: string; // UUID sinh 1 lần khi mở form, KHÔNG sinh lại mỗi lần retry
}

export type IdempotencyClaim<T> = { replay: true; result: T } | { replay: false };

/** Chiếm khoá bên trong transaction của caller để ghép được với giao dịch kho. */
export async function claimIdempotencyKey<T>(tx: Prisma.TransactionClient, opts: IdempotencyOptions): Promise<IdempotencyClaim<T>> {
  const inserted = await tx.$executeRaw`
    INSERT INTO idempotency_keys ("userId", "scope", "key", "createdAt")
    VALUES (${opts.userId}, ${opts.scope}, ${opts.key}, now())
    ON CONFLICT DO NOTHING`;
  if (inserted !== 0) return { replay: false };
  const row = await tx.idempotencyKey.findUniqueOrThrow({ where: { userId_scope_key: { userId: opts.userId, scope: opts.scope, key: opts.key } } });
  return { replay: true, result: row.responseJson as T };
}

/** Chuẩn hoá JSON trước khi lưu để lần đầu và lần lặp trả về cùng một shape. */
export async function saveIdempotencyResult<T>(tx: Prisma.TransactionClient, opts: IdempotencyOptions, raw: T): Promise<T> {
  const result = (raw === undefined ? null : JSON.parse(JSON.stringify(raw))) as T;
  await tx.idempotencyKey.update({ where: { userId_scope_key: { userId: opts.userId, scope: opts.scope, key: opts.key } }, data: { responseJson: result === null ? undefined : (result as Prisma.InputJsonValue) } });
  return result;
}

/**
 * Chạy `work` đúng 1 lần cho mỗi (userId, scope, key).
 * Khoá và work nằm CÙNG 1 transaction: request đến sau bị chặn ở INSERT cho tới khi request đầu commit,
 * rồi đọc kết quả đã lưu; nếu request đầu lỗi (rollback) thì request sau tự chạy lại.
 * `work` phải trả giá trị JSON-hoá được (id, chuỗi, số) — kết quả luôn được chuẩn hoá qua JSON
 * để lần đầu và lần lặp trả cùng một dạng.
 * D-10: payload trả về được LƯU nguyên văn trong idempotency_keys → work KHÔNG được trả về bí mật
 * (mật khẩu tạm...); chỉ trả id/số chứng từ, còn bí mật đưa ra khỏi kênh này.
 */
export async function withIdempotency<T>(
  prisma: PrismaClient,
  opts: IdempotencyOptions,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  /** Mặc định 30 giây; nhập hàng loạt truyền dài hơn. */
  timeoutMs = 30_000,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const claim = await claimIdempotencyKey<T>(tx, opts);
      if (claim.replay) return claim.result;
      return saveIdempotencyResult(tx, opts, await work(tx));
    },
    { maxWait: 10_000, timeout: timeoutMs },
  );
}
