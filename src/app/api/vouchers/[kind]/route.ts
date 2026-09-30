import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { paymentSchema, receiptSchema } from "@/server/cash/schemas";
import { parseVoucherKind, voucherPerm } from "@/server/cash/route-helpers";
import { createPaymentIdempotent, createReceiptIdempotent } from "@/server/cash/vouchers";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";

/** Lập phiếu thu/chi (56–59). */
export const POST = apiHandler<{ params: Promise<{ kind: string }> }>(async (req, ctx) => {
  const doc = parseVoucherKind((await ctx.params).kind);
  const actor = await requireActorApi(voucherPerm(doc));
  const key = readIdempotencyKey(req);
  return doc === "RECEIPT" ? createReceiptIdempotent(prisma, actor, key, receiptSchema.parse(await readJson(req))) : createPaymentIdempotent(prisma, actor, key, paymentSchema.parse(await readJson(req)));
});
