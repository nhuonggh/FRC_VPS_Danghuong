import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readIdempotencyKey } from "@/server/http/read-json";
import { confirmStocktakeIdempotent } from "@/server/stocktake/service";

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => confirmStocktakeIdempotent(prisma, await requireActorApi("stocktake.manage"), readIdempotencyKey(req), idParam.parse((await ctx.params).id)));
