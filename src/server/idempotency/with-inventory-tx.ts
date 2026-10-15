import type { PrismaClient } from "@prisma/client";
import { type EngineCtx, withInventoryTx, type WithInventoryOptions } from "@/server/inventory";
import { claimIdempotencyKey, saveIdempotencyResult } from "./with-idempotency";

/** D-17: idempotency key và toàn bộ ghi kho nằm trong CÙNG transaction engine. */
export async function withIdempotentInventoryTx<R>(prisma: PrismaClient, opts: WithInventoryOptions & { scope: string; key: string }, work: (ctx: EngineCtx) => Promise<R>): Promise<R> {
  const idem = { userId: opts.userId, scope: opts.scope, key: opts.key };
  return withInventoryTx(prisma, opts, async (ctx) => {
    const claim = await claimIdempotencyKey<R>(ctx.tx, idem);
    if (claim.replay) return claim.result;
    return saveIdempotencyResult(ctx.tx, idem, await work(ctx));
  });
}
