import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";
import { orderActionSchema } from "@/server/supplier-orders/schemas";
import { actOnOrder } from "@/server/supplier-orders/service";
import { z } from "zod";
export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => actOnOrder(prisma, await requireActorApi("purchase.edit"), z.coerce.number().int().positive().parse((await ctx.params).id), orderActionSchema.parse(await readJson(req))));
