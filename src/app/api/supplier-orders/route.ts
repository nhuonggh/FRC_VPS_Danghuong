import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { supplierOrderSchema } from "@/server/supplier-orders/schemas";
import { createSupplierOrder } from "@/server/supplier-orders/service";
export const POST = apiHandler(async req => createSupplierOrder(prisma, await requireActorApi("purchase.create"), readIdempotencyKey(req), supplierOrderSchema.parse(await readJson(req))));
