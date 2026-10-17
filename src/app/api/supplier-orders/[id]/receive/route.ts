import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { receiveOrderSchema } from "@/server/supplier-orders/schemas";
import { receiveSupplierOrder } from "@/server/supplier-orders/service";
import { z } from "zod";
export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => receiveSupplierOrder(prisma, await requireActorApi("purchase.create"), z.coerce.number().int().positive().parse((await ctx.params).id), readIdempotencyKey(req), receiveOrderSchema.parse(await readJson(req))));
