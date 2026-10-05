import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createDraftSaleOrderIdempotent } from "@/server/sales/service";

/** Lưu NHÁP đơn bán: chưa xuất kho/công nợ; xác nhận sau ở trang chi tiết. Idempotency-Key bắt buộc. */
export const POST = apiHandler(async (req) =>
  createDraftSaleOrderIdempotent(prisma, await requireActorApi("order.create"), readIdempotencyKey(req), saleOrderSchema.parse(await readJson(req))),
);
