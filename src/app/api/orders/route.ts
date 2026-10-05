import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { checkoutSchema, createCheckoutSaleOrderIdempotent } from "@/server/sales/checkout";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";

/**
 * Lập đơn bán: xuất kho FIFO ngay (D-25). Idempotency-Key bắt buộc — bấm hai lần chỉ tạo một đơn.
 * Có `checkout` (bán tại quầy): cùng giao dịch còn lập phiếu thu và/hoặc phiếu giao; khách lẻ thì partnerId do server gán (KHL).
 */
export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("order.create");
  const key = readIdempotencyKey(req);
  const body = (await readJson(req)) as Record<string, unknown>;
  if (body.checkout === undefined) return createSaleOrderIdempotent(prisma, actor, key, saleOrderSchema.parse(body));
  const checkout = checkoutSchema.parse(body.checkout);
  const input = saleOrderSchema.parse(checkout.walkIn ? { ...body, partnerId: 1 } : body); // khách lẻ: partnerId giữ chỗ, server thay bằng KHL
  return createCheckoutSaleOrderIdempotent(prisma, actor, key, input, checkout);
});
