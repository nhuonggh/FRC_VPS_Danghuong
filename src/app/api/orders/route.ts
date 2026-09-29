import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";

/** Lập đơn bán: xuất kho FIFO ngay (D-25). Idempotency-Key bắt buộc — bấm hai lần chỉ tạo một đơn. */
export const POST = apiHandler(async (req) =>
  createSaleOrderIdempotent(prisma, await requireActorApi("order.create"), readIdempotencyKey(req), saleOrderSchema.parse(await readJson(req))),
);
